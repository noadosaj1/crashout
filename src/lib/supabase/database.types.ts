/**
 * Hand-maintained mirror of supabase/migrations. Only the columns the client
 * actually reads or writes are modelled.
 */
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          username: string
          avatar: string | null
          credits: number
          level: number
          experience: number
          active_vehicle_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          username: string
          avatar?: string | null
          active_vehicle_id?: string | null
        }
        Update: {
          username?: string
          avatar?: string | null
          active_vehicle_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      player_vehicles: {
        Row: {
          id: string
          owner_id: string
          spec_id: string
          nickname: string | null
          paint: string
          wheel_style: string
          accent: string
          created_at: string
        }
        Insert: { owner_id: string; spec_id: string; nickname?: string | null }
        Update: { nickname?: string | null }
        Relationships: []
      }
      vehicle_upgrades: {
        Row: {
          player_vehicle_id: string
          engine: number
          brakes: number
          handling: number
          acceleration: number
          durability: number
        }
        Insert: { player_vehicle_id: string }
        Update: never
        Relationships: []
      }
      player_inventory: {
        Row: { id: string; owner_id: string; gadget_id: string; quantity: number; created_at: string }
        Insert: never
        Update: never
        Relationships: []
      }
      player_stats: {
        Row: {
          player_id: string
          distance_driven: number
          crashes: number
          biggest_crash: number
          races_won: number
          deliveries_completed: number
          credits_earned: number
          updated_at: string
        }
        Insert: { player_id: string }
        Update: {
          distance_driven?: number
          crashes?: number
          biggest_crash?: number
          updated_at?: string
        }
        Relationships: []
      }
      sessions: {
        Row: {
          id: string
          code: string
          host_id: string
          is_open: boolean
          max_players: number
          created_at: string
          closed_at: string | null
        }
        Insert: { code: string; host_id: string; max_players?: number }
        Update: { is_open?: boolean; closed_at?: string | null }
        Relationships: []
      }
      session_members: {
        Row: { session_id: string; player_id: string; joined_at: string }
        Insert: { session_id: string; player_id: string }
        Update: never
        Relationships: []
      }
      challenge_results: {
        Row: {
          id: string
          player_id: string
          activity_id: string
          score: number
          time_ms: number
          reward: number
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      purchase_vehicle: {
        Args: { p_spec_id: string }
        Returns: Database['public']['Tables']['player_vehicles']['Row']
      }
      purchase_upgrade: {
        Args: { p_vehicle_id: string; p_key: string }
        Returns: Database['public']['Tables']['vehicle_upgrades']['Row']
      }
      purchase_customization: {
        Args: { p_vehicle_id: string; p_kind: string; p_option_id: string }
        Returns: Database['public']['Tables']['player_vehicles']['Row']
      }
      purchase_gadget: {
        Args: { p_gadget_id: string }
        Returns: Database['public']['Tables']['player_inventory']['Row']
      }
      repair_vehicle: { Args: { p_vehicle_id: string; p_damage: number }; Returns: number }
      award_activity_reward: {
        Args: { p_activity_id: string; p_elapsed_seconds: number; p_damage: number; p_score: number }
        Returns: number
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
