// que modelo se manda de verdad con un proveedor.
//
// Por que existe: el modelo elegido se recuerda por conversacion y sobrevive a
// cambiar de proveedor. Un modelo de otra familia NO existe para el proveedor
// nuevo, y mandarlo igual devuelve `unrecognized_model` —gastando la llamada,
// porque la pasarela cobra por llamada y no por token—.
//
// Paso de verdad: con el proveedor cambiado a Claude y el modelo aun en
// `DeepSeek-V4-Pro`, cinco llamadas seguidas fallaron asi.
//
// El id de proveedor ES la familia del modelo: asi los registra el agente.

/** lo minimo que hace falta de un modelo del catalogo para elegirlo */
export interface SelectableModel {
  apiModel: string;
  family: string;
  enabled: boolean;
}

/**
 * el modelo que debe viajar, o `null` para dejarlo al de la conexion.
 *
 * `null` no es un fallo: es el comportamiento por defecto de siempre, y es la
 * respuesta correcta cuando lo elegido no encaja con el proveedor actual.
 */
export function modelForProvider(
  models: readonly SelectableModel[],
  provider: string,
  chosen: string | null,
): string | null {
  if (chosen === null || chosen.length === 0) return null;

  const belongs = models.some(
    (model) => model.enabled && model.family === provider && model.apiModel === chosen,
  );
  return belongs ? chosen : null;
}

/** los modelos que ese proveedor sirve de verdad */
export function modelsForProvider(
  models: readonly SelectableModel[],
  provider: string,
): SelectableModel[] {
  return models.filter((model) => model.enabled && model.family === provider);
}
