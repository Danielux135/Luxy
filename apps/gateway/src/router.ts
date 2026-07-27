// enrutador minimo con soporte de parametros ":nombre" en la ruta.
// se evita un framework: el worker solo tiene una decena de rutas.

export type RouteHandler<D> = (
  request: Request,
  deps: D,
  params: Record<string, string>,
) => Promise<Response>;

interface Route<D> {
  method: string;
  segments: string[];
  handler: RouteHandler<D>;
}

export class Router<D> {
  private readonly routes: Route<D>[] = [];

  add(method: string, pattern: string, handler: RouteHandler<D>): this {
    this.routes.push({
      method: method.toUpperCase(),
      segments: pattern.split('/').filter((segment) => segment.length > 0),
      handler,
    });
    return this;
  }

  get(pattern: string, handler: RouteHandler<D>): this {
    return this.add('GET', pattern, handler);
  }

  post(pattern: string, handler: RouteHandler<D>): this {
    return this.add('POST', pattern, handler);
  }

  /** busca la ruta que encaja y devuelve el manejador con sus parametros */
  match(
    method: string,
    pathname: string,
  ): { handler: RouteHandler<D>; params: Record<string, string> } | null {
    const parts = pathname.split('/').filter((segment) => segment.length > 0);

    for (const route of this.routes) {
      if (route.method !== method.toUpperCase()) continue;
      if (route.segments.length !== parts.length) continue;

      const params: Record<string, string> = {};
      let matched = true;
      for (let index = 0; index < route.segments.length; index += 1) {
        const expected = route.segments[index]!;
        const actual = parts[index]!;
        if (expected.startsWith(':')) {
          params[expected.slice(1)] = decodeURIComponent(actual);
        } else if (expected !== actual) {
          matched = false;
          break;
        }
      }
      if (matched) return { handler: route.handler, params };
    }
    return null;
  }

  async handle(request: Request, deps: D): Promise<Response | null> {
    const url = new URL(request.url);
    const found = this.match(request.method, url.pathname);
    if (!found) return null;
    return found.handler(request, deps, found.params);
  }
}
