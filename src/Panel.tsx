import { useState } from 'react';
import type { RoomClient, Snapshot } from './lib/RoomClient';
import { EXTEND_MS, MAX_EXTENSIONS, MAX_MEMBERS, REPORT_REASONS } from './lib/config';
import { hueOf } from './lib/util';
import { Icon, Overlay } from './ui';

interface Props {
  s: Snapshot;
  client: RoomClient;
  soundOn: boolean;
  setSoundOn: (v: boolean) => void;
  onClose: () => void;
}

export function Panel({ s, client, soundOn, setSoundOn, onClose }: Props) {
  const [reporting, setReporting] = useState<{ id: string; name: string } | null>(null);
  const [sent, setSent] = useState('');

  return (
    <>
      <div className="sheet-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <aside className="sheet" aria-label="People and room settings">
          <div className="sheet-head">
            <h2>
              People <span className="count">{s.people.length}/{MAX_MEMBERS}</span>
            </h2>
            <button className="ib" onClick={onClose} aria-label="Close">
              <Icon.Close />
            </button>
          </div>

          <ul className="people">
            {s.people.map((p) => (
              <li key={p.id}>
                <span className="dot" style={{ ['--h' as string]: hueOf(p.name) }} />
                <span className="pname">
                  {p.name}
                  {p.me && <em> (you)</em>}
                  {p.muted && <em className="warn"> muted by room</em>}
                  {p.blocked && !p.muted && <em className="warn"> blocked</em>}
                </span>
                {!p.me && (
                  <span className="row-actions">
                    {p.blocked ? (
                      <button className="link" onClick={() => client.unblock(p.id)}>
                        Unblock
                      </button>
                    ) : (
                      <button className="link" onClick={() => client.block(p.id)}>
                        Block
                      </button>
                    )}
                    <button className="link danger" onClick={() => setReporting({ id: p.id, name: p.name })}>
                      Report
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
          {sent && <p className="ok">{sent}</p>}

          <section className="block">
            <h3>Time</h3>
            <p className="muted">
              Everyone can vote to add {EXTEND_MS / 60000} minutes. A majority is needed. Up to {MAX_EXTENSIONS} times per room.
            </p>
            <button
              className={'btn ' + (s.votes.mine ? 'ghost' : '')}
              disabled={s.votes.maxed}
              onClick={() => client.voteExtend(!s.votes.mine)}
            >
              {s.votes.maxed ? 'No more extensions' : s.votes.mine ? 'Withdraw my vote' : `Vote to add ${EXTEND_MS / 60000} minutes`}
            </button>
            <p className="muted">
              {s.votes.maxed
                ? `All ${MAX_EXTENSIONS} extensions used.`
                : `${s.votes.count} of ${s.votes.needed} votes needed · ${s.extensions} of ${MAX_EXTENSIONS} extensions used`}
            </p>
          </section>

          <section className="block">
            <h3>Room</h3>
            <p className="muted">
              {s.locked
                ? 'Locked with a PIN. The PIN is part of the key people use to connect, so anyone with the wrong PIN cannot see this room.'
                : s.pub
                  ? 'Public. Anyone online can find this room with Random.'
                  : 'Private. Only people with the code can join.'}
            </p>
            <label className="check">
              <input type="checkbox" checked={soundOn} onChange={(e) => setSoundOn(e.target.checked)} />
              Play a sound for new messages when this tab is in the background
            </label>
            <p className="muted small">
              Reports mute someone for the whole room once enough people report them. There is no server, so nothing is sent to us.
            </p>
          </section>
        </aside>
      </div>

      {reporting && (
        <Overlay label="Report someone" onClose={() => setReporting(null)}>
          <div className="card">
            <h2 className="dlg-title">Report {reporting.name}</h2>
            <p className="muted">They will be blocked for you straight away. Other people see the report too.</p>
            <div className="reasons">
              {REPORT_REASONS.map((r) => (
                <button
                  key={r}
                  className="btn ghost"
                  onClick={() => {
                    client.report(reporting.id, r);
                    setSent(`${reporting.name} was reported and blocked.`);
                    setReporting(null);
                  }}
                >
                  {r}
                </button>
              ))}
            </div>
            <button className="link" onClick={() => setReporting(null)}>
              Cancel
            </button>
          </div>
        </Overlay>
      )}
    </>
  );
}
