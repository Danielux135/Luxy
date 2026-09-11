// la memoria de un turno privado, tal y como la separo el agente.
//
// Por que existe. El agente ejecuta cada turno privado como una conversacion de
// Studio, y el job-runner SEPARA el bloque `<LUXY_MEMORY>` de la respuesta antes
// de devolverla. El proceso principal volvia a buscarlo en un texto que ya no lo
// llevaba: salia `absent` en TODOS los turnos y la memoria acumulativa de las
// conversaciones privadas no se guardaba nunca. Y el modelo seguia escribiendo
// el bloque, asi que esos tokens se pagaban para tirarlos.
//
// Ahora el agente la manda aparte, junto al texto. Si no la manda —un agente
// viejo que todavia no conoce el campo— se busca en el texto como antes.
import type { ConversationMemory, ConversationMemoryStatus } from '@luxy/shared';

export interface TurnMemory {
  memory: ConversationMemory | null;
  status: ConversationMemoryStatus;
}

/** lo que el agente dice de la memoria del turno; ausente en uno viejo */
export interface AgentTurnMemory {
  memory?: ConversationMemory | null;
  memoryStatus?: ConversationMemoryStatus | null;
}

/**
 * la memoria que cuenta para este turno.
 *
 * Manda la del agente cuando la trae. El agente solo incluye la memoria si la
 * respuesta termino bien, asi que un estado `structured` sin memoria es una
 * respuesta cortada con el bloque entero: se informa el estado y NO se guarda
 * nada, que es el invariante de «una respuesta que no termina bien no escribe
 * memoria».
 */
export function memoryOfTurn(fromAgent: AgentTurnMemory, parsedFromText: TurnMemory): TurnMemory {
  if (fromAgent.memoryStatus === undefined || fromAgent.memoryStatus === null) {
    return parsedFromText;
  }
  return { memory: fromAgent.memory ?? null, status: fromAgent.memoryStatus };
}
