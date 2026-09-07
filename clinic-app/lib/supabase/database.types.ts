/**
 * Hand-written to match supabase/migrations/0001_init.sql, in the same
 * shape `supabase gen types typescript --local` would produce.
 *
 * Regenerate for real once local Supabase is running:
 *   npm run db:start && npm run db:types
 * That command OVERWRITES this file — safe to run any time the schema
 * changes, since it's generated output, not hand-maintained logic.
 *
 * Every table needs a `Relationships: []` array (foreign-key metadata
 * used for typed embedded selects, e.g. `.select("*, doctors(*)")` — we
 * don't use that yet, so all empty) and the schema needs `Views`/
 * `Functions` present, or @supabase/postgrest-js's `GenericSchema`
 * constraint isn't satisfied and every query resolves to `never`
 * instead of the real row type. Found the hard way via `npm run
 * typecheck` failing across lib/doctors.ts and lib/settings.ts.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type AppointmentStatus =
  | "Confirmed"
  | "Cancelled"
  | "Completed"
  | "No-Show";

export type Weekday =
  | "Monday"
  | "Tuesday"
  | "Wednesday"
  | "Thursday"
  | "Friday"
  | "Saturday"
  | "Sunday";

export type AdminRole = "ADMIN" | "RECEPTIONIST";

export interface Database {
  public: {
    Tables: {
      doctors: {
        Row: {
          id: string;
          doctor_code: string;
          name: string;
          clinic_name: string;
          calendar_id: string;
          whatsapp_phone: string;
          appointment_duration_minutes: number;
          active: boolean;
          specialization: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["doctors"]["Row"]> & {
          doctor_code: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["doctors"]["Row"]>;
        Relationships: [];
      };
      doctor_availability: {
        Row: {
          id: string;
          doctor_id: string;
          day_of_week: Weekday;
          start_time: string; // "HH:MM:SS"
          end_time: string;
          created_at: string;
        };
        Insert: Partial<
          Database["public"]["Tables"]["doctor_availability"]["Row"]
        > & {
          doctor_id: string;
          day_of_week: Weekday;
          start_time: string;
          end_time: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["doctor_availability"]["Row"]
        >;
        Relationships: [
          {
            foreignKeyName: "doctor_availability_doctor_id_fkey";
            columns: ["doctor_id"];
            isOneToOne: false;
            referencedRelation: "doctors";
            referencedColumns: ["id"];
          }
        ];
      };
      doctor_leaves: {
        Row: {
          id: string;
          doctor_id: string;
          leave_date: string; // "YYYY-MM-DD"
          reason: string;
          active: boolean;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["doctor_leaves"]["Row"]> & {
          doctor_id: string;
          leave_date: string;
        };
        Update: Partial<Database["public"]["Tables"]["doctor_leaves"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "doctor_leaves_doctor_id_fkey";
            columns: ["doctor_id"];
            isOneToOne: false;
            referencedRelation: "doctors";
            referencedColumns: ["id"];
          }
        ];
      };
      patients: {
        Row: {
          id: string;
          patient_code: string;
          phone: string;
          name: string;
          language: string;
          notes: string;
          first_seen_at: string;
          last_visit_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["patients"]["Row"]> & {
          patient_code: string;
          phone: string;
        };
        Update: Partial<Database["public"]["Tables"]["patients"]["Row"]>;
        Relationships: [];
      };
      appointments: {
        Row: {
          id: string;
          appointment_code: string;
          doctor_id: string;
          patient_id: string | null;
          patient_name: string;
          patient_phone: string;
          appointment_date: string; // "YYYY-MM-DD"
          appointment_time: string; // "HH:MM:SS"
          status: AppointmentStatus;
          calendar_event_id: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["appointments"]["Row"]> & {
          appointment_code: string;
          doctor_id: string;
          patient_name: string;
          patient_phone: string;
          appointment_date: string;
          appointment_time: string;
        };
        Update: Partial<Database["public"]["Tables"]["appointments"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "appointments_doctor_id_fkey";
            columns: ["doctor_id"];
            isOneToOne: false;
            referencedRelation: "doctors";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "appointments_patient_id_fkey";
            columns: ["patient_id"];
            isOneToOne: false;
            referencedRelation: "patients";
            referencedColumns: ["id"];
          }
        ];
      };
      whatsapp_sessions: {
        Row: {
          phone: string;
          role: string;
          state: string;
          doctor_id: string | null;
          session_date: string;
          session_time: string;
          appointment_id: string | null;
          language: string;
          patient_name: string;
          slot_page: number;
          appointment_page: number;
          doctor_menu_tier: string;
          list_page: number;
          location: string;
          updated_at: string;
        };
        Insert: Partial<
          Database["public"]["Tables"]["whatsapp_sessions"]["Row"]
        > & {
          phone: string;
        };
        Update: Partial<Database["public"]["Tables"]["whatsapp_sessions"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "whatsapp_sessions_doctor_id_fkey";
            columns: ["doctor_id"];
            isOneToOne: false;
            referencedRelation: "doctors";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "whatsapp_sessions_appointment_id_fkey";
            columns: ["appointment_id"];
            isOneToOne: false;
            referencedRelation: "appointments";
            referencedColumns: ["id"];
          }
        ];
      };
      home_collection_requests: {
        Row: {
          id: string;
          request_code: string;
          phone: string;
          patient_name: string;
          latitude: number;
          longitude: number;
          distance_km: number;
          preferred_date: string;
          time_window: string;
          status: string;
          created_at: string;
        };
        Insert: Partial<
          Database["public"]["Tables"]["home_collection_requests"]["Row"]
        > & {
          request_code: string;
          phone: string;
          latitude: number;
          longitude: number;
          distance_km: number;
          preferred_date: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["home_collection_requests"]["Row"]
        >;
        Relationships: [];
      };
      message_log: {
        Row: {
          id: string;
          logged_at: string;
          direction: string;
          phone: string;
          patient_name: string;
          status: string;
          message: string;
          appointment_id: string | null;
          hours_before: number | null;
          phone_number_id: string;
        };
        Insert: Partial<Database["public"]["Tables"]["message_log"]["Row"]> & {
          direction: string;
        };
        Update: Partial<Database["public"]["Tables"]["message_log"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "message_log_appointment_id_fkey";
            columns: ["appointment_id"];
            isOneToOne: false;
            referencedRelation: "appointments";
            referencedColumns: ["id"];
          }
        ];
      };
      settings: {
        Row: {
          key: string;
          value: string;
          updated_at: string;
        };
        Insert: {
          key: string;
          value: string;
        };
        Update: Partial<Database["public"]["Tables"]["settings"]["Row"]>;
        Relationships: [];
      };
      admin_users: {
        Row: {
          id: string;
          email: string;
          password_hash: string;
          full_name: string;
          role: AdminRole;
          active: boolean;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["admin_users"]["Row"]> & {
          email: string;
          password_hash: string;
        };
        Update: Partial<Database["public"]["Tables"]["admin_users"]["Row"]>;
        Relationships: [];
      };
      whatsapp_message_dedup: {
        Row: {
          message_id: string;
          processed_at: string;
        };
        Insert: {
          message_id: string;
          processed_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["whatsapp_message_dedup"]["Row"]
        >;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
