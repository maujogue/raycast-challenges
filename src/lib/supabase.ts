import { createClient } from "@supabase/supabase-js";
import { PROJECT_URL, SUPABASE_PUBLIC_KEY } from "./constants";

export const supabase = createClient(PROJECT_URL, SUPABASE_PUBLIC_KEY);
