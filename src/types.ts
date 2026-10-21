export interface User {
  id: string;
  name: string;
  email: string;
}
export interface Team {
  id: string;
  name: string;
  owner_id: string;
}
export type Kind = "note" | "board" | "diagram";
export interface Note {
  id: string;
  title: string;
  kind: Kind;
  template: string;
  team_id: string | null;
  owner_id: string;
  updated_at: string;
  deleted_at: string | null;
  favorite: boolean;
  excerpt?: string;
}
export interface Comment {
  id: string;
  name: string;
  body: string;
  created_at: string;
}
