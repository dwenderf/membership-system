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
          is_lgbtq: boolean | null
          is_goalie: boolean
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
          is_lgbtq?: boolean | null
          is_goalie?: boolean
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
          is_lgbtq?: boolean | null
          is_goalie?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      categories: {
        Row: {
          id: string
          name: string
          description: string | null
          category_type: 'system' | 'user'
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          category_type: 'system' | 'user'
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          category_type?: 'system' | 'user'
          created_by?: string | null
          created_at?: string
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
          name: string
          description: string | null
          price_monthly: number
          price_annual: number
          accounting_code: string | null
          allow_discounts: boolean
          allow_monthly: boolean
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          price_monthly: number
          price_annual: number
          accounting_code?: string | null
          allow_discounts?: boolean
          allow_monthly?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          price_monthly?: number
          price_annual?: number
          accounting_code?: string | null
          allow_discounts?: boolean
          allow_monthly?: boolean
          created_at?: string
        }
      }
      registrations: {
        Row: {
          id: string
          season_id: string
          name: string
          type: 'team' | 'scrimmage' | 'event'
          allow_discounts: boolean
          is_active: boolean
          presale_start_at: string | null
          regular_start_at: string | null
          registration_end_at: string | null
          presale_code: string | null
          allow_lgbtq_presale: boolean
          created_at: string
        }
        Insert: {
          id?: string
          season_id: string
          name: string
          type: 'team' | 'scrimmage' | 'event'
          allow_discounts?: boolean
          is_active?: boolean
          presale_start_at?: string | null
          regular_start_at?: string | null
          registration_end_at?: string | null
          presale_code?: string | null
          allow_lgbtq_presale?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          season_id?: string
          name?: string
          type?: 'team' | 'scrimmage' | 'event'
          allow_discounts?: boolean
          is_active?: boolean
          presale_start_at?: string | null
          regular_start_at?: string | null
          registration_end_at?: string | null
          presale_code?: string | null
          allow_lgbtq_presale?: boolean
          created_at?: string
        }
      }
      user_memberships: {
        Row: {
          id: string
          user_id: string
          membership_id: string
          payment_id: string | null
          xero_invoice_id: string | null
          valid_from: string
          valid_until: string
          months_purchased: number | null
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
          payment_id?: string | null
          xero_invoice_id?: string | null
          valid_from: string
          valid_until: string
          months_purchased?: number | null
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
          payment_id?: string | null
          xero_invoice_id?: string | null
          valid_from?: string
          valid_until?: string
          months_purchased?: number | null
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
          registration_category_id: string | null
          user_membership_id: string | null
          payment_id: string | null
          xero_invoice_id: string | null
          payment_status: 'awaiting_payment' | 'processing' | 'paid' | 'failed' | 'refunded'
          registration_fee: number | null
          amount_paid: number | null
          presale_code_used: string | null
          stripe_payment_intent_id: string | null
          reservation_expires_at: string | null
          registered_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          registration_id: string
          registration_category_id?: string | null
          user_membership_id?: string | null
          payment_id?: string | null
          xero_invoice_id?: string | null
          payment_status: 'awaiting_payment' | 'processing' | 'paid' | 'failed' | 'refunded'
          registration_fee?: number | null
          amount_paid?: number | null
          presale_code_used?: string | null
          stripe_payment_intent_id?: string | null
          reservation_expires_at?: string | null
          registered_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          registration_id?: string
          registration_category_id?: string | null
          user_membership_id?: string | null
          payment_id?: string | null
          xero_invoice_id?: string | null
          payment_status?: 'awaiting_payment' | 'processing' | 'paid' | 'failed' | 'refunded'
          registration_fee?: number | null
          amount_paid?: number | null
          presale_code_used?: string | null
          stripe_payment_intent_id?: string | null
          reservation_expires_at?: string | null
          registered_at?: string | null
          created_at?: string
        }
      }
      payments: {
        Row: {
          id: string
          user_id: string
          total_amount: number
          discount_amount: number
          final_amount: number
          stripe_payment_intent_id: string | null
          status: 'pending' | 'completed' | 'failed' | 'refunded' | 'cancelled'
          payment_method: string
          created_at: string
          completed_at: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          total_amount: number
          discount_amount?: number
          final_amount: number
          stripe_payment_intent_id?: string | null
          status?: 'pending' | 'completed' | 'failed' | 'refunded' | 'cancelled'
          payment_method?: string
          created_at?: string
          completed_at?: string | null
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          total_amount?: number
          discount_amount?: number
          final_amount?: number
          stripe_payment_intent_id?: string | null
          status?: 'pending' | 'completed' | 'failed' | 'refunded' | 'cancelled'
          payment_method?: string
          created_at?: string
          completed_at?: string | null
          updated_at?: string
        }
      }
      xero_invoices: {
        Row: {
          id: string
          payment_id: string | null
          tenant_id: string | null
          xero_invoice_id: string | null
          invoice_number: string | null
          invoice_type: string
          invoice_status: string
          total_amount: number
          discount_amount: number
          net_amount: number
          stripe_fee_amount: number
          sync_status: 'pending' | 'staged' | 'synced' | 'failed' | 'needs_update'
          last_synced_at: string | null
          sync_error: string | null
          staged_at: string | null
          staging_metadata: any | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          payment_id?: string | null
          tenant_id?: string | null
          xero_invoice_id?: string
          invoice_number?: string | null
          invoice_type?: string
          invoice_status: string
          total_amount: number
          discount_amount?: number
          net_amount: number
          stripe_fee_amount?: number
          sync_status: 'pending' | 'staged' | 'synced' | 'failed' | 'needs_update'
          last_synced_at?: string | null
          sync_error?: string | null
          staged_at?: string | null
          staging_metadata?: any | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          payment_id?: string | null
          tenant_id?: string | null
          xero_invoice_id?: string | null
          invoice_number?: string | null
          invoice_type?: string
          invoice_status?: string
          total_amount?: number
          discount_amount?: number
          net_amount?: number
          stripe_fee_amount?: number
          sync_status?: 'pending' | 'staged' | 'synced' | 'failed' | 'needs_update'
          last_synced_at?: string | null
          sync_error?: string | null
          staged_at?: string | null
          staging_metadata?: any | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "xero_invoices_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "xero_invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "xero_oauth_tokens"
            referencedColumns: ["tenant_id"]
          }
        ]
      }
      xero_payments: {
        Row: {
          id: string
          xero_invoice_id: string
          tenant_id: string | null
          xero_payment_id: string | null
          payment_method: string
          bank_account_code: string | null
          amount_paid: number
          stripe_fee_amount: number
          reference: string | null
          sync_status: 'pending' | 'staged' | 'synced' | 'failed' | 'needs_update'
          last_synced_at: string | null
          sync_error: string | null
          staged_at: string | null
          staging_metadata: any | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          xero_invoice_id: string
          tenant_id?: string | null
          xero_payment_id?: string | null
          payment_method?: string
          bank_account_code?: string | null
          amount_paid: number
          stripe_fee_amount?: number
          reference?: string | null
          sync_status: 'pending' | 'staged' | 'synced' | 'failed' | 'needs_update'
          last_synced_at?: string | null
          sync_error?: string | null
          staged_at?: string | null
          staging_metadata?: any | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          xero_invoice_id?: string
          tenant_id?: string | null
          xero_payment_id?: string | null
          payment_method?: string
          bank_account_code?: string | null
          amount_paid?: number
          stripe_fee_amount?: number
          reference?: string | null
          sync_status?: 'pending' | 'staged' | 'synced' | 'failed' | 'needs_update'
          last_synced_at?: string | null
          sync_error?: string | null
          staged_at?: string | null
          staging_metadata?: any | null
          created_at?: string
          updated_at?: string
        }
      }
      xero_invoice_line_items: {
        Row: {
          id: string
          xero_invoice_id: string
          line_item_type: 'membership' | 'registration' | 'discount' | 'donation'
          item_id: string | null
          description: string
          quantity: number
          unit_amount: number
          account_code: string | null
          tax_type: string
          line_amount: number
          created_at: string
        }
        Insert: {
          id?: string
          xero_invoice_id: string
          line_item_type: 'membership' | 'registration' | 'discount' | 'donation'
          item_id?: string | null
          description: string
          quantity?: number
          unit_amount: number
          account_code?: string | null
          tax_type?: string
          line_amount: number
          created_at?: string
        }
        Update: {
          id?: string
          xero_invoice_id?: string
          line_item_type?: 'membership' | 'registration' | 'discount' | 'donation'
          item_id?: string | null
          description?: string
          quantity?: number
          unit_amount?: number
          account_code?: string | null
          tax_type?: string
          line_amount?: number
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