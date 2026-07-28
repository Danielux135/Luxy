// ejecucion de aprobaciones: commit, descartar y push.
//
// Hasta ahora esto no existia. El gateway creaba la aprobacion, respondia "la
// maquina lo ejecutara" y nadie la leia; commitWorktree y removeWorktree eran
// codigo muerto. Y allowCommit/allowPush estaban en el esquema sin que ningun
// codigo los comprobase en tiempo de ejecucion.
//
// LAS PUERTAS SE COMPRUEBAN AQUI, en el agente, no en la interfaz de Telegram ni
// en la de escritorio. Una interfaz puede estar comprometida; esta es la ultima
// barrera antes de tocar el repositorio del usuario.
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { redact } from '@luxy/shared';
import type { AgentConfig, ProjectConfig } from '@luxy/shared';
import { commitWorktree, pushWorktree, removeWorktree, status, type Worktree } from './git.js';
import { confinePath, PathConfinementError } from './tools/confine.js';

export type ApprovalAction = 'commit' | 'discard' | 'push';

export interface ApprovalRequest {
  approvalId: string;
  jobId: string;
  shortId: string;
  action: ApprovalAction;
  projectAlias: string;
  worktreePath: string;
  branch: string;
  /** mensaje del commit; para push y discard se ignora */
  message?: string;
  /** el usuario confirmo DOS veces. obligatorio para push */
  confirmedTwice: boolean;
  /** de donde vino la orden, para poder auditarla */
  source: 'telegram' | 'desktop';
  requestedBy: string;
}

export interface ApprovalOutcome {
  ok: boolean;
  action: ApprovalAction;
  message: string;
  /** motivo del rechazo cuando una puerta lo impide */
  deniedBy: string | null;
}

export interface ApprovalDeps {
  config: AgentConfig;
  /** carpeta base de los worktrees: nada fuera de aqui se toca */
  worktreesDirectory: string;
  /** archivo de auditoria, en la carpeta de registros */
  auditFile: string;
}

export class ApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApprovalError';
  }
}

/**
 * aprobaciones ya consumidas.
 *
 * una aprobacion vale UNA vez: si se pudiera reutilizar, un reenvio del mismo
 * mensaje bastaria para repetir un push.
 */
const consumed = new Set<string>();

export function resetConsumedApprovals(): void {
  consumed.clear();
}

/** registro append-only de todo lo que se intenta, se permita o no */
function audit(deps: ApprovalDeps, request: ApprovalRequest, outcome: ApprovalOutcome): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    approvalId: request.approvalId,
    jobId: request.jobId,
    shortId: request.shortId,
    action: request.action,
    project: request.projectAlias,
    source: request.source,
    requestedBy: request.requestedBy,
    confirmedTwice: request.confirmedTwice,
    ok: outcome.ok,
    deniedBy: outcome.deniedBy,
    result: redact(outcome.message).slice(0, 500),
  });
  try {
    mkdirSync(dirname(deps.auditFile), { recursive: true });
    appendFileSync(deps.auditFile, `${line}\n`, 'utf8');
  } catch {
    // que no se pueda auditar no debe impedir denegar; si se pudo hacer la
    // accion, ya esta hecha y el fallo de escritura no la deshace
  }
}

/**
 * comprueba las puertas de politica.
 * devuelve el motivo del rechazo, o null si se puede proceder.
 */
export function checkApprovalGates(
  request: ApprovalRequest,
  project: ProjectConfig | undefined,
): string | null {
  if (project === undefined) {
    return `el proyecto "${request.projectAlias}" no esta configurado en esta maquina`;
  }
  if (consumed.has(request.approvalId)) {
    return 'esa aprobacion ya se uso; pide una nueva';
  }

  switch (request.action) {
    case 'commit':
      if (!project.allowCommit) {
        return `el proyecto "${request.projectAlias}" no permite crear commits`;
      }
      return null;

    case 'push':
      // dos condiciones independientes, y las dos son obligatorias
      if (!project.allowPush) {
        return `el proyecto "${request.projectAlias}" no permite hacer push`;
      }
      if (!request.confirmedTwice) {
        return 'el push exige una segunda confirmacion explicita';
      }
      return null;

    case 'discard':
      // descartar no publica nada ni escribe en el repositorio principal
      return null;
  }
}

/**
 * ejecuta una aprobacion.
 *
 * nunca lanza: un rechazo es un resultado, no una excepcion, porque el usuario
 * tiene que ver por que no se hizo.
 */
export async function executeApproval(
  request: ApprovalRequest,
  deps: ApprovalDeps,
): Promise<ApprovalOutcome> {
  const project = deps.config.projects[request.projectAlias];

  const denied = checkApprovalGates(request, project);
  if (denied !== null) {
    const outcome: ApprovalOutcome = {
      ok: false,
      action: request.action,
      message: denied,
      deniedBy: denied,
    };
    audit(deps, request, outcome);
    return outcome;
  }

  // la ruta del worktree viene de fuera: se confina antes de tocarla, igual que
  // cualquier ruta que maneje una herramienta
  let worktreePath: string;
  try {
    worktreePath = confinePath({
      root: deps.worktreesDirectory,
      candidate: request.worktreePath,
    });
  } catch (error) {
    const message =
      error instanceof PathConfinementError
        ? `la ruta del worktree no es valida: ${error.message}`
        : 'la ruta del worktree no es valida';
    const outcome: ApprovalOutcome = {
      ok: false,
      action: request.action,
      message,
      deniedBy: message,
    };
    audit(deps, request, outcome);
    return outcome;
  }

  let outcome: ApprovalOutcome;
  try {
    outcome = await perform(request, worktreePath);
  } catch (error) {
    outcome = {
      ok: false,
      action: request.action,
      message: redact(error instanceof Error ? error.message : String(error)),
      deniedBy: null,
    };
  }

  // se marca consumida haya salido bien o mal: reintentar exige una nueva
  consumed.add(request.approvalId);
  audit(deps, request, outcome);
  return outcome;
}

async function perform(request: ApprovalRequest, worktreePath: string): Promise<ApprovalOutcome> {
  switch (request.action) {
    case 'commit': {
      const pending = await status(worktreePath);
      if (pending.trim().length === 0) {
        return { ok: false, action: 'commit', message: 'no hay cambios que confirmar', deniedBy: null };
      }
      const message = buildCommitMessage(request);
      const result = await commitWorktree(worktreePath, message);
      return {
        ok: result.ok,
        action: 'commit',
        message: result.ok ? `commit creado en ${request.branch}` : result.output,
        deniedBy: null,
      };
    }

    case 'push': {
      const result = await pushWorktree(worktreePath, request.branch);
      return {
        ok: result.ok,
        action: 'push',
        message: result.ok ? `rama ${request.branch} publicada` : result.output,
        deniedBy: null,
      };
    }

    case 'discard': {
      const worktree: Worktree = {
        path: worktreePath,
        branch: request.branch,
        baseRepository: '',
      };
      await removeWorktree(worktree, { force: true });
      return { ok: true, action: 'discard', message: 'worktree descartado', deniedBy: null };
    }
  }
}

/**
 * mensaje del commit.
 *
 * el texto del usuario se recorta y se limpia de saltos de linea: va como
 * argumento separado a git, nunca por shell, pero un mensaje de varias lineas
 * confunde el historial.
 */
export function buildCommitMessage(request: ApprovalRequest): string {
  const custom = (request.message ?? '').replace(/\s+/g, ' ').trim();
  const base = custom.length > 0 ? custom.slice(0, 200) : `trabajo ${request.shortId}`;
  return `${base}\n\nLuxy: ${request.shortId}`;
}

/** ruta del registro de auditoria */
export function auditFilePath(logsDirectory: string): string {
  return join(logsDirectory, 'approvals.log');
}
