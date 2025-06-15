export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          email: string
          first_name: string
          last_name: string
          phone: string | null
          is_admin: boolean
          tags: string[] | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          email: string
          first_name: string
          last_name: string
          phone?: string | null
          is_admin?: boolean
          tags?: string[] | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          first_name?: string
          last_name?: string
          phone?: string | null
          is_admin?: boolean
          tags?: string[] | null
          created_at?: string
          updated_at?: string
        }
      }
      seasons: {
        Row: {
          id: string
          name: string
          type: 'fall_winter' | 'spring_summer'
          start_date: string
          end_date: string
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          type: 'fall_winter' | 'spring_summer'
          start_date: string
          end_date: string
          is_active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          type?: 'fall_winter' | 'spring_summer'
          start_date?: string
          end_date?: string
          is_active?: boolean
          created_at?: string
        }
      }
      memberships: {
        Row: {
          id: string
          season_id: string
          name: string
          price: number
          accounting_code: string | null
          allow_discounts: boolean
          created_at: string
        }
        Insert: {
          id?: string
          season_id: string
          name: string
          price: number
          accounting_code?: string | null
          allow_discounts?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          season_id?: string
          name?: string
          price?: number
          accounting_code?: string | null
          allow_discounts?: boolean
          created_at?: string
        }
      }
      registrations: {
        Row: {
          id: string
          season_id: string
          required_membership_id: string | null
          name: string
          type: 'team' | 'scrimmage' | 'event'
          allow_discounts: boolean
          created_at: string
        }
        Insert: {
          id?: string
          season_id: string
          required_membership_id?: string | null
          name: string
          type: 'team' | 'scrimmage' | 'event'
          allow_discounts?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          season_id?: string
          required_membership_id?: string | null
          name?: string
          type?: 'team' | 'scrimmage' | 'event'
          allow_discounts?: boolean
          created_at?: string
        }
      }
      user_memberships: {
        Row: {
          id: string
          user_id: string
          membership_id: string
          payment_status: 'pending' | 'paid' | 'refunded'
          stripe_payment_intent_id: string | null
          amount_paid: number | null
          purchased_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          membership_id: string
          payment_status: 'pending' | 'paid' | 'refunded'
          stripe_payment_intent_id?: string | null
          amount_paid?: number | null
          purchased_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          membership_id?: string
          payment_status?: 'pending' | 'paid' | 'refunded'
          stripe_payment_intent_id?: string | null
          amount_paid?: number | null
          purchased_at?: string | null
          created_at?: string
        }
      }
      user_registrations: {
        Row: {
          id: string
          user_id: string
          registration_id: string
          user_membership_id: string | null
          payment_status: 'pending' | 'paid' | 'refunded'
          registration_fee: number | null
          amount_paid: number | null
          registered_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          registration_id: string
          user_membership_id?: string | null
          payment_status: 'pending' | 'paid' | 'refunded'
          registration_fee?: number | null
          amount_paid?: number | null
          registered_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          registration_id?: string
          user_membership_id?: string | null
          payment_status?: 'pending' | 'paid' | 'refunded'
          registration_fee?: number | null
          amount_paid?: number | null
          registered_at?: string | null
          created_at?: string
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
  }
}