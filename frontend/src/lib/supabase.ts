import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://gzphjdkcuaiqrsmukuvd.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd6cGhqZGtjdWFpcXJzbXVrdXZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5MjcxMzgsImV4cCI6MjA5OTUwMzEzOH0._zITFVXOYfs8y39cib_VA14dFhMMy0WnUqa9QwO7vKs";

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export interface AuthUser { id: string; email: string; }

export async function signIn(email: string, password: string): Promise<AuthUser | null> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user ? { id: data.user.id, email: data.user.email || "" } : null;
}

export async function signUp(email: string, password: string): Promise<AuthUser | null> {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data.user ? { id: data.user.id, email: data.user.email || "" } : null;
}

export async function signOut(): Promise<void> { await supabase.auth.signOut(); }

export async function getCurrentSession(): Promise<AuthUser | null> {
  const { data } = await supabase.auth.getSession();
  if (data.session?.user) return { id: data.session.user.id, email: data.session.user.email || "" };
  return null;
}

export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
}

export function onAuthChange(callback: (user: AuthUser | null) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.user) callback({ id: session.user.id, email: session.user.email || "" });
    else callback(null);
  });
  return () => data.subscription.unsubscribe();
}
