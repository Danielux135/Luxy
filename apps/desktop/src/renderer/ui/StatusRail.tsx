// barra de estado: el instrumento que esta siempre delante.
//
// la traza de latido es la pieza que da identidad a Luxy. No es adorno: cada
// pico es un heartbeat real recibido del gateway, y cuando la conexion se cae
// la linea se aplana. Un usuario que mira Luxy de reojo tiene que saber si su
// maquina sigue viva sin leer una sola palabra.
import { useEffect, useRef, useState, type JSX } from 'react';
import type { AgentHostStatus } from '@luxy/shared';

const POINTS = 48;
const WIDTH = 132;
const HEIGHT = 26;

/** convierte la serie de latidos en la polilinea de la traza */
function buildPath(samples: number[]): string {
  const step = WIDTH / (POINTS - 1);
  return samples
    .map((value, index) => {
      // 0 = reposo (linea media), 1 = pico
      const y = HEIGHT / 2 - value * (HEIGHT / 2 - 3);
      return `${(index * step).toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export interface HeartbeatTraceProps {
  /** marca de tiempo del ultimo latido; un valor nuevo genera un pico */
  lastBeatAt: string | null;
  connected: boolean;
}

export function HeartbeatTrace({ lastBeatAt, connected }: HeartbeatTraceProps): JSX.Element {
  const [samples, setSamples] = useState<number[]>(() => new Array(POINTS).fill(0));
  const previousBeat = useRef<string | null>(null);

  // la traza avanza sola para que se note que el tiempo pasa; el pico solo
  // aparece cuando llega un latido de verdad
  useEffect(() => {
    const timer = setInterval(() => {
      setSamples((previous) => {
        const beat = lastBeatAt !== null && lastBeatAt !== previousBeat.current;
        if (beat) previousBeat.current = lastBeatAt;
        const next = beat ? 1 : 0;
        return [...previous.slice(1), next];
      });
    }, 420);
    return () => clearInterval(timer);
  }, [lastBeatAt]);

  const label = connected
    ? 'Traza de latido: la maquina responde'
    : 'Traza de latido plana: sin conexion con el gateway';

  return (
    <svg
      className={`trace${connected ? '' : ' trace--flat'}`}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={label}
      preserveAspectRatio="none"
    >
      <polyline className="trace__line" points={buildPath(connected ? samples : samples.map(() => 0))} />
    </svg>
  );
}

const RUN_STATE_LAMP: Record<string, 'true' | 'false' | 'busy' | 'fault'> = {
  running: 'true',
  starting: 'busy',
  stopping: 'busy',
  stopped: 'false',
};

export function StatusRail({ status }: { status: AgentHostStatus }): JSX.Element {
  const connected = status.agent?.gatewayConnected ?? false;
  const machine = status.agent?.machineName ?? 'sin configurar';

  return (
    <header className="status">
      <span className="status__brand">LUXY</span>
      <span className="status__machine">
        maquina <b>{machine}</b>
      </span>

      <span className="status__spacer" />

      <HeartbeatTrace lastBeatAt={status.agent?.lastHeartbeatAt ?? null} connected={connected} />

      <span className="lamp" data-on={connected ? 'true' : status.lastError === null ? 'false' : 'fault'}>
        {connected ? 'Gateway' : 'Sin gateway'}
      </span>
      <span className="lamp" data-on={RUN_STATE_LAMP[status.runState] ?? 'false'}>
        {status.runState === 'running' ? 'Agente' : RUN_STATE_LABEL[status.runState]}
      </span>
    </header>
  );
}

export const RUN_STATE_LABEL: Record<string, string> = {
  stopped: 'Detenido',
  starting: 'Arrancando',
  running: 'En marcha',
  stopping: 'Deteniendo',
};
