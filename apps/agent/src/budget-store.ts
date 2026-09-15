// presupuesto diario que sobrevive a cerrar Luxy.
//
// POR QUE EXISTE: el presupuesto vivia solo en memoria del proceso. Con eso, un
// limite «diario» se reinicia cada vez que se abre Studio, y el contador de
// llamadas —lo unico que protege contra una pasarela con tarifa plana POR
// LLAMADA— habria dado una falsa sensacion de proteccion: cuenta hasta que
// cierras la ventana. En el registro del 4 al 14 de septiembre hay dias con
// varias sesiones; un tope que se olvida entre ellas no es un tope.
//
// Lo que se guarda son CIFRAS: dia, gasto, tokens y numero de llamadas. Ni
// prompts, ni respuestas, ni claves.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BudgetState } from '@luxy/shared';
import { budgetStateSchema } from '@luxy/shared';
import type { BudgetStore } from './providers/http-provider.js';
import { stateDir } from './paths.js';

/**
 * almacen del presupuesto respaldado por un archivo JSON.
 *
 * el estado se mantiene en memoria y el archivo es el respaldo: leer de disco
 * en cada llamada no aporta nada y si añade una forma de fallar en el camino
 * caliente.
 *
 * NINGUN fallo de disco puede costar un turno. Si no se puede leer, se empieza
 * de cero; si no se puede escribir, el proceso sigue con su copia en memoria y
 * lo unico que se pierde es la memoria entre sesiones.
 */
export class FileBudgetStore implements BudgetStore {
  private readonly file: string;
  private state: BudgetState = {};

  constructor(
    directory: string = stateDir(),
    /** avisa de un disco que no deja escribir; no interrumpe nada */
    private readonly onError?: (error: unknown) => void,
  ) {
    this.file = join(directory, 'budget.json');
    try {
      mkdirSync(directory, { recursive: true });
    } catch (error) {
      this.onError?.(error);
    }
    this.state = this.restore();
  }

  read(): BudgetState {
    return this.state;
  }

  write(state: BudgetState): void {
    this.state = state;
    try {
      // se escribe a un temporal y se renombra: un corte de luz a mitad no
      // puede dejar un presupuesto ilegible, que es como se pierde la cuenta
      // del dia entero
      const temporal = `${this.file}.tmp`;
      writeFileSync(temporal, JSON.stringify(state), 'utf8');
      renameSync(temporal, this.file);
    } catch (error) {
      this.onError?.(error);
    }
  }

  /** lo que quedo de la sesion anterior, o nada si el archivo no sirve */
  private restore(): BudgetState {
    let bruto: unknown;
    try {
      bruto = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch {
      // no existe todavia, o no es JSON. Las dos cosas significan lo mismo
      // aqui: hoy no hay nada gastado que recordar
      return {};
    }

    // se salva lo que encaje en vez de tirar el archivo entero: una entrada
    // corrupta de un proveedor no puede borrar la cuenta de los demas
    const parsed = budgetStateSchema.safeParse(bruto);
    if (parsed.success) return parsed.data;

    if (typeof bruto !== 'object' || bruto === null) return {};
    const rescatado: BudgetState = {};
    for (const [id, entrada] of Object.entries(bruto as Record<string, unknown>)) {
      const uno = budgetStateSchema.safeParse({ [id]: entrada });
      if (uno.success) Object.assign(rescatado, uno.data);
    }
    return rescatado;
  }

  /** ruta del archivo, para diagnostico */
  get path(): string {
    return this.file;
  }
}
