// comprobaciones estructurales de las migraciones SQL.
//
// LIMITACION: estas pruebas NO ejecutan el SQL contra un Postgres real, porque
// este equipo no tiene psql ni docker. Verifican invariantes de seguridad y de
// forma que se pueden comprobar sin base de datos. Antes de aplicar las
// migraciones a un Supabase real hay que ejecutarlas en un proyecto de pruebas.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'supabase',
  'migrations',
);

function readMigrations(): Array<{ name: string; sql: string }> {
  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(migrationsDir, name), 'utf8') }));
}

const migrations = readMigrations();
const allSql = migrations.map((m) => m.sql).join('\n');

describe('migraciones - estructura', () => {
  it('existen migraciones', () => {
    expect(migrations.length).toBeGreaterThan(0);
  });

  it('estan numeradas de forma ordenable', () => {
    for (const migration of migrations) {
      expect(migration.name).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
    }
  });

  it('los delimitadores $$ estan equilibrados en cada archivo', () => {
    for (const migration of migrations) {
      const count = (migration.sql.match(/\$\$/g) ?? []).length;
      expect(count % 2, `${migration.name} tiene $$ desequilibrados`).toBe(0);
    }
  });

  it('los parentesis estan equilibrados en cada archivo', () => {
    for (const migration of migrations) {
      // se ignoran los parentesis dentro de literales de cadena
      const sinCadenas = migration.sql.replace(/'(?:[^']|'')*'/g, "''");
      const abiertos = (sinCadenas.match(/\(/g) ?? []).length;
      const cerrados = (sinCadenas.match(/\)/g) ?? []).length;
      expect(abiertos, `${migration.name}`).toBe(cerrados);
    }
  });
});

describe('migraciones - tablas exigidas', () => {
  const tablas = [
    'telegram_updates',
    'telegram_users',
    'machines',
    'machine_tokens',
    'jobs',
    'job_events',
    'approvals',
    'provider_usage',
  ];

  it('crea todas las tablas del diseño', () => {
    for (const tabla of tablas) {
      expect(allSql, `falta la tabla ${tabla}`).toMatch(
        new RegExp(`create table if not exists public\\.${tabla}\\b`, 'i'),
      );
    }
  });

  it('update_id es unico, que es lo que da idempotencia a telegram', () => {
    expect(allSql).toMatch(/update_id\s+bigint\s+primary key/i);
  });

  it('las secuencias de eventos son unicas por trabajo', () => {
    expect(allSql).toMatch(/unique\s*\(job_id,\s*sequence\)/i);
  });

  it('el identificador corto de trabajo es unico', () => {
    expect(allSql).toMatch(/jobs_short_id_unique unique \(short_id\)/i);
  });

  it('el nombre de maquina es unico', () => {
    expect(allSql).toMatch(/machines_name_unique unique \(name\)/i);
  });
});

describe('migraciones - seguridad', () => {
  it('activa RLS en todas las tablas', () => {
    const tablas = [
      'telegram_updates',
      'telegram_users',
      'machines',
      'machine_tokens',
      'jobs',
      'job_events',
      'approvals',
      'provider_usage',
    ];
    for (const tabla of tablas) {
      expect(allSql, `RLS no activado en ${tabla}`).toMatch(
        new RegExp(`alter table public\\.${tabla}\\s+enable row level security`, 'i'),
      );
    }
  });

  it('revoca cualquier acceso a anon y authenticated', () => {
    expect(allSql).toMatch(/revoke all on all tables in schema public from anon, authenticated/i);
    expect(allSql).toMatch(/revoke all on all functions in schema public from anon, authenticated/i);
  });

  it('no crea ninguna politica que abra el acceso publico', () => {
    // sin politicas y con RLS activo, el acceso queda denegado por defecto
    expect(allSql).not.toMatch(/create policy[\s\S]*?to\s+(anon|authenticated|public)\b/i);
  });

  it('el token de maquina se guarda solo como hash', () => {
    expect(allSql).toMatch(/token_hash\s+text not null/i);
    // no debe existir ninguna columna que guarde el token en claro
    expect(allSql).not.toMatch(/\btoken\s+text\b/i);
  });

  it('no contiene ningun secreto real', () => {
    expect(allSql).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);
    expect(allSql).not.toMatch(/\d{8,}:[A-Za-z0-9_-]{30,}/);
  });
});

describe('migraciones - reclamacion atomica y leases', () => {
  it('define la funcion de reclamacion', () => {
    expect(allSql).toMatch(/create or replace function public\.luxy_claim_job/i);
  });

  it('usa FOR UPDATE SKIP LOCKED para que dos maquinas nunca cojan el mismo trabajo', () => {
    expect(allSql).toMatch(/for update skip locked/i);
  });

  it('la reclamacion devuelve como maximo un trabajo', () => {
    const funcion = allSql.slice(
      allSql.indexOf('luxy_claim_job'),
      allSql.indexOf('luxy_renew_lease'),
    );
    expect(funcion).toMatch(/limit 1/i);
  });

  it('la reclamacion ignora los trabajos con cancelacion solicitada', () => {
    const funcion = allSql.slice(
      allSql.indexOf('luxy_claim_job'),
      allSql.indexOf('luxy_renew_lease'),
    );
    expect(funcion).toMatch(/cancel_requested_at is null/i);
  });

  it('la reclamacion ignora las maquinas deshabilitadas', () => {
    const funcion = allSql.slice(
      allSql.indexOf('luxy_claim_job'),
      allSql.indexOf('luxy_renew_lease'),
    );
    expect(funcion).toMatch(/m\.enabled/i);
  });

  it('la reclamacion respeta la maquina objetivo', () => {
    const funcion = allSql.slice(
      allSql.indexOf('luxy_claim_job'),
      allSql.indexOf('luxy_renew_lease'),
    );
    expect(funcion).toMatch(/target_machine_id is null or j\.target_machine_id = p_machine_id/i);
  });

  it('solo recupera leases caducados cuando el trabajo no habia empezado', () => {
    const funcion = allSql.slice(
      allSql.indexOf('luxy_claim_job'),
      allSql.indexOf('luxy_renew_lease'),
    );
    // esta es la garantia de que no se pierden cambios locales
    expect(funcion).toMatch(/j\.started_at is null/i);
  });

  it('define la renovacion de lease restringida a la maquina propietaria', () => {
    expect(allSql).toMatch(/create or replace function public\.luxy_renew_lease/i);
    const funcion = allSql.slice(
      allSql.indexOf('luxy_renew_lease'),
      allSql.indexOf('luxy_expire_leases'),
    );
    expect(funcion).toMatch(/j\.claimed_by = p_machine_id/i);
  });

  it('el barrido marca como interrumpidos los trabajos ya empezados, sin reasignarlos', () => {
    const funcion = allSql.slice(allSql.indexOf('luxy_expire_leases'));
    expect(funcion).toMatch(/'interrupted'/i);
    expect(funcion).toMatch(/started_at is not null/i);
  });

  it('la cancelacion no borra nada: solo marca la peticion', () => {
    const funcion = allSql.slice(allSql.indexOf('luxy_request_cancel'));
    expect(funcion).toMatch(/cancel_requested_at = coalesce/i);
    expect(funcion).not.toMatch(/delete from/i);
  });

  it('las funciones no son accesibles para anon ni authenticated', () => {
    expect(allSql).toMatch(/revoke all on function public\.luxy_claim_job.*from anon, authenticated/i);
  });
});

describe('migraciones - indices', () => {
  it('indexa la cola de trabajos', () => {
    expect(allSql).toMatch(/create index if not exists jobs_queue_idx/i);
  });

  it('indexa los leases para el barrido periodico', () => {
    expect(allSql).toMatch(/create index if not exists jobs_lease_idx/i);
  });

  it('indexa los eventos por trabajo y secuencia', () => {
    expect(allSql).toMatch(/create index if not exists job_events_job_idx/i);
  });
});
