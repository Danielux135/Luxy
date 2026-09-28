// el bloque del resumen de otras conversaciones y la guia de campos (`D-105`).
// Todo el texto es inventado.
import { describe, expect, it } from 'vitest';
import {
  VAULT_MEMORY_FIELD_GUIDE_BODY,
  buildVaultPrompt,
  composeVaultPrompt,
  measureVaultPrompt,
  type VaultPromptInput,
} from './vault-prompt.js';
import { CONVERSATION_MEMORY_INSTRUCTION, type ConversationMemory } from './schemas.js';
import type { RecentMemoryEntry } from './vault-recent-memories.js';

const memoria: ConversationMemory = {
  version: 1,
  summary: 'un resumen inventado de esta conversacion',
  facts: [],
  decisions: [],
  plan: [],
  openQuestions: [],
  lessons: [],
};

const base: VaultPromptInput = {
  memory: memoria,
  turns: [
    { role: 'user', text: 'hola inventado' },
    { role: 'assistant', text: 'respuesta inventada' },
  ],
  message: 'mensaje inventado',
  character: 'Una pintora inventada.',
  pending: [
    {
      by: 'user',
      day: '2026-09-20',
      daysAgo: 5,
      quote: 'te traigo un cuadro inventado',
      raisedCount: 0,
      lastRaisedDaysAgo: null,
      heMentionedDaysAgo: null,
      touchedNow: false,
    },
  ],
};

const recientes: RecentMemoryEntry[] = [
  { date: 'ayer', title: 'El puerto inventado', text: 'Pasearon por un puerto inventado.' },
  { date: 'hace 3 dias', title: 'La tormenta', text: 'Se refugiaron de una tormenta inventada.' },
];

describe('resumen de otras conversaciones en el prompt', () => {
  it('APAGADO: sin entradas, vacio o sin guia, el prompt sale byte a byte igual', () => {
    const referencia = buildVaultPrompt(base);
    expect(buildVaultPrompt({ ...base, recentMemories: [] })).toBe(referencia);
    expect(
      buildVaultPrompt({ ...base, recentMemories: undefined, memoryFieldGuide: false }),
    ).toBe(referencia);
    expect(composeVaultPrompt({ ...base, recentMemories: [] }).map((b) => b.label)).toEqual(
      composeVaultPrompt(base).map((b) => b.label),
    );
  });

  it('con entradas va despues de pendientes y antes de memoria, como DATOS', () => {
    const bloques = composeVaultPrompt({ ...base, recentMemories: recientes });
    const etiquetas = bloques.map((b) => b.label);
    expect(etiquetas.indexOf('recientes')).toBeGreaterThan(etiquetas.indexOf('pendientes'));
    expect(etiquetas.indexOf('recientes')).toBeLessThan(etiquetas.indexOf('memoria'));

    const texto = bloques.find((b) => b.label === 'recientes')!.text;
    expect(texto).toContain('(DATOS)');
    expect(texto).toContain('DE OTRAS CONVERSACIONES CON EL, NO DE ESTA');
    expect(texto).toContain('De aqui sabes SOLO lo que pone.');
    expect(texto).toContain('No lo copies a la memoria de esta conversacion');
    expect(texto).toContain('- ayer · «El puerto inventado»');
    expect(texto).toContain('Pasearon por un puerto inventado.');
  });

  // revision del 28/09: lo prometido en otra conversacion viajaba en cada turno
  // sin el tope de `D-104`, y la regla de pendientes decia a la vez que toda
  // promesa fuera de su lista «no se hizo»
  it('lo prometido ahi no es un guion, y la regla de pendientes lo reconoce', () => {
    const bloques = composeVaultPrompt({ ...base, recentMemories: recientes });
    const texto = bloques.find((b) => b.label === 'recientes')!.text;
    expect(texto).toContain('no es un guion ni un recordatorio');
    const pendientes = bloques.find((b) => b.label === 'pendientes')!.text;
    expect(pendientes).toContain('en lo que sabes de otras conversaciones');
    expect(pendientes).not.toContain('no se hizo');
    // sin resumen ni tope, la regla de siempre, intacta
    const apagado = composeVaultPrompt(base).find((b) => b.label === 'pendientes')!.text;
    expect(apagado).toContain('transcrito no se hizo: no la reclames ni la des por hecha.');
    expect(apagado).not.toContain('otras conversaciones ni en');
  });

  it('con una sola entrada habla en singular', () => {
    const texto = composeVaultPrompt({ ...base, recentMemories: [recientes[0]!] }).find(
      (b) => b.label === 'recientes',
    )!.text;
    expect(texto).toContain('DE OTRA CONVERSACION CON EL, NO DE ESTA');
    expect(texto).toContain('otra conversacion tuya con el');
  });

  it('measureVaultPrompt lo cuenta', () => {
    const medidas = measureVaultPrompt(composeVaultPrompt({ ...base, recentMemories: recientes }));
    expect(medidas.some((m) => m.label === 'recientes' && m.chars > 0)).toBe(true);
  });

  it('la guia de campos sale solo encendida y justo antes de la instruccion de memoria', () => {
    expect(composeVaultPrompt(base).some((b) => b.label === 'guia-memoria')).toBe(false);
    const etiquetas = composeVaultPrompt({ ...base, memoryFieldGuide: true }).map((b) => b.label);
    const guia = etiquetas.indexOf('guia-memoria');
    expect(guia).toBeGreaterThan(-1);
    expect(etiquetas[guia + 1]).toBe('instruccion-memoria');
    expect(buildVaultPrompt({ ...base, memoryFieldGuide: true })).toContain(
      VAULT_MEMORY_FIELD_GUIDE_BODY,
    );
  });

  it('la instruccion de memoria compartida con el agente no cambia', () => {
    const bloques = composeVaultPrompt({ ...base, recentMemories: recientes, memoryFieldGuide: true });
    expect(bloques[bloques.length - 1]).toEqual({
      label: 'instruccion-memoria',
      text: CONVERSATION_MEMORY_INSTRUCTION,
    });
    expect(CONVERSATION_MEMORY_INSTRUCTION).not.toContain('acordado');
  });
});
