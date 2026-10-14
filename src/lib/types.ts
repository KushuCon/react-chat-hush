export interface ReplyRef {
  id: string;
  name: string;
  text: string;
}

export interface Msg {
  id: string;
  who: string; // peer id of the sender ('sys' for notices)
  name: string;
  ts: number;
  me: boolean;
  sys?: boolean;
  text?: string;
  img?: string;
  once?: boolean; // view-once photo
  opened?: boolean; // view-once photo already opened
  re?: ReplyRef;
  reactions: Record<string, string[]>; // emoji -> peer ids
  deleted?: boolean;
}

export interface Peer {
  name: string;
  joinedAt: number;
}

/** What this device advertises to the lobby. */
export interface Status {
  code: string | null; // set only for public rooms
  count: number;
  created: number;
}

export type EndReason = 'time' | 'full' | 'left';
