// mide cuantos registros aguanta cada modelo en UNA llamada.
// con facturacion por llamada, esa cifra es la que divide la factura.
import { readFileSync } from 'node:fs';
import { buildBatchPrompt } from './apps/agent/src/batch/model.ts';
import { sseData, TurnAssembler, wasTruncated } from './apps/agent/src/providers/sse.ts';

const key = /^sk-[A-Za-z0-9]{40,}$/m.exec(
  readFileSync('C:/Users/daniel/Desktop/Luxy claves API.txt', 'utf8'),
)![0];

function filas(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: String(i + 1),
    referencia: `FE-${1000 + i}`,
    nombre: `articulo numero ${i + 1}`,
    descripcion: `DESCRIPCION LARGA del producto ${i + 1},   con detalles tecnicos, medidas 250 MM y peso 1200 gr,, incluye accesorios`,
    familia: i % 4 === 0 ? '' : 'herramienta manual',
    precio: String((i % 90) + 0.99),
    stock: String(i % 50),
  }));
}

const INSTRUCCION =
  'limpia la descripcion: quita espacios y comas sobrantes, unifica unidades a minusculas con espacio. Conserva el resto igual.';

async function medir(model: string, n: number) {
  const rows = filas(n);
  const prompt = buildBatchPrompt(rows, INSTRUCCION, 0);
  const t0 = Date.now();
  try {
    const r = await fetch('https://api.hcnsec.cn/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 65536,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: AbortSignal.timeout(300_000),
    });
    if (!r.ok) {
      const t = await r.text();
      return { model, n, estado: `HTTP ${r.status}`, detalle: t.slice(0, 90).replace(/\s+/g, ' ') };
    }
    const a = new TurnAssembler();
    for await (const p of sseData(r.body!)) a.push(p);
    const t = a.result();
    const seg = ((Date.now() - t0) / 1000).toFixed(0);

    if (t.streamError) return { model, n, estado: 'ERROR EN FLUJO', detalle: t.streamError.slice(0, 80), seg };
    if (wasTruncated(t)) return { model, n, estado: 'CORTADO', detalle: `${t.outputTokens} tokens`, seg };

    let devueltos = 0;
    try {
      const limpio = t.text.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
      const parsed = JSON.parse(limpio.slice(limpio.search(/[[{]/)));
      devueltos = (Array.isArray(parsed) ? parsed : parsed.results ?? []).length;
    } catch {
      return { model, n, estado: 'JSON INVALIDO', detalle: `${t.text.length} car`, seg };
    }
    return {
      model, n, seg,
      estado: devueltos === n ? 'OK' : `INCOMPLETO ${devueltos}/${n}`,
      detalle: `entrada=${t.inputTokens} salida=${t.outputTokens} razon=${a.reasoningLength()}car`,
    };
  } catch (e) {
    return { model, n, estado: 'EXCEPCION', detalle: (e as Error).message.slice(0, 80), seg: ((Date.now() - t0) / 1000).toFixed(0) };
  }
}

const modelos = process.argv.slice(3);
const N = Number(process.argv[2]);
console.log(`### lote de ${N} registros, max_tokens=65536\n`);
for (const m of modelos) {
  const r = await medir(m, N);
  console.log(`${r.model.padEnd(22)} ${String(r.estado).padEnd(18)} ${r.seg ?? '-'}s  ${r.detalle}`);
}
