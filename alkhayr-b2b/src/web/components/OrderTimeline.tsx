import type { OrderState } from '../api/contracts.ts';
import { formatDateTime } from '../format.ts';
import { ORDER_FLOW, ORDER_STATE_LABEL } from '../labels.ts';
import { Icon } from './Icon.tsx';

/**
 * Order progress from the order's own event history (snapshots; never recomputed).
 * Trader events have no actor or reason (the API omits them deliberately); administrator
 * events may carry both and are shown only when present.
 */
export interface TimelineEvent {
  fromState: OrderState | null;
  toState: OrderState;
  at: number;
  actor?: string | null;
  reason?: string | null;
}

export function OrderTimeline({ state, events }: { state: OrderState; events: TimelineEvent[] }) {
  const reached = new Map(events.map((e) => [e.toState, e]));
  const cancelled = state === 'cancelled';
  const steps: OrderState[] = cancelled ? [...ORDER_FLOW.filter((s) => reached.has(s)), 'cancelled'] : [...ORDER_FLOW];
  return (
    <ol className="c-timeline" aria-label="مراحل الطلب">
      {steps.map((s) => {
        const event = reached.get(s);
        const status = s === 'cancelled' ? 'cancelled' : s === state ? 'current' : event ? 'done' : 'upcoming';
        return (
          <li key={s} className={`c-timeline__item c-timeline__item--${status}`} {...(s === state ? { 'aria-current': 'step' as const } : {})}>
            <span className="c-timeline__dot">
              <Icon name={status === 'cancelled' ? 'x' : status === 'upcoming' ? 'clock' : 'check'} />
            </span>
            <div>
              <div className="c-timeline__title">
                {ORDER_STATE_LABEL[s]}
                {status === 'upcoming' ? <span className="visually-hidden"> (لم تتم بعد)</span> : null}
              </div>
              {event ? (
                <div className="c-timeline__meta">
                  <time dateTime={new Date(event.at).toISOString()}>{formatDateTime(event.at)}</time>
                  {event.actor ? <> — بواسطة {event.actor}</> : null}
                </div>
              ) : null}
              {event?.reason ? <div className="c-timeline__meta">السبب: {event.reason}</div> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
