-- membership_analytics_data previously excluded expired memberships entirely
-- (latest_memberships filtered um.valid_until >= CURRENT_DATE before the
-- DISTINCT ON that picks each user's most recent purchase per membership
-- type), so the view's own 'Expired' expiration_status branch was dead code
-- and the admin memberships report had no way to list lapsed members.
--
-- Drop that filter so a user whose latest purchase has lapsed still shows
-- (as 'Expired'), while a user who renewed still shows only their current
-- row (DISTINCT ON ... ORDER BY valid_until DESC already picks the latest
-- purchase regardless of the filter). membership_stats now scopes its
-- aggregates (total_members, lgbtq_count, etc.) to valid_until >= CURRENT_DATE
-- so those figures keep describing the current membership base, not the
-- newly-included historical/expired rows.
CREATE OR REPLACE VIEW public.membership_analytics_data WITH (security_invoker=true) AS
 WITH latest_memberships AS (
         SELECT DISTINCT ON (um.user_id, um.membership_id) um.user_id,
            um.membership_id,
            um.valid_until,
            um.valid_from,
            u.member_id,
            u.first_name,
            u.last_name,
            u.email,
            u.onboarding_completed_at,
            u.is_lgbtq,
            u.is_goalie,
            m.name AS membership_name,
            m.description AS membership_description
           FROM user_memberships um
             JOIN users u ON um.user_id = u.id
             JOIN memberships m ON um.membership_id = m.id
          WHERE um.payment_status = 'paid'::text AND u.deleted_at IS NULL
          ORDER BY um.user_id, um.membership_id, um.valid_until DESC
        ), membership_stats AS (
         SELECT latest_memberships.membership_id,
            latest_memberships.membership_name,
            latest_memberships.membership_description,
            count(*) FILTER (WHERE latest_memberships.valid_until >= CURRENT_DATE) AS total_members,
            count(*) FILTER (WHERE latest_memberships.valid_until >= CURRENT_DATE AND latest_memberships.is_lgbtq = true) AS lgbtq_count,
            count(*) FILTER (WHERE latest_memberships.valid_until >= CURRENT_DATE AND latest_memberships.is_lgbtq IS NULL) AS prefer_not_to_say_count,
            count(*) FILTER (WHERE latest_memberships.valid_until >= CURRENT_DATE AND latest_memberships.is_goalie = true) AS goalie_count,
                CASE
                    WHEN (count(*) FILTER (WHERE latest_memberships.valid_until >= CURRENT_DATE) - count(*) FILTER (WHERE latest_memberships.valid_until >= CURRENT_DATE AND latest_memberships.is_lgbtq IS NULL)) > 0 THEN round(count(*) FILTER (WHERE latest_memberships.valid_until >= CURRENT_DATE AND latest_memberships.is_lgbtq = true)::numeric / (count(*) FILTER (WHERE latest_memberships.valid_until >= CURRENT_DATE) - count(*) FILTER (WHERE latest_memberships.valid_until >= CURRENT_DATE AND latest_memberships.is_lgbtq IS NULL))::numeric * 100::numeric, 1)
                    ELSE 0::numeric
                END AS lgbtq_percent
           FROM latest_memberships
          GROUP BY latest_memberships.membership_id, latest_memberships.membership_name, latest_memberships.membership_description
        )
 SELECT lm.user_id,
    lm.membership_id,
    lm.valid_until,
    lm.valid_from,
    lm.member_id,
    lm.first_name,
    lm.last_name,
    lm.email,
    lm.onboarding_completed_at,
    lm.is_lgbtq,
    lm.is_goalie,
    lm.membership_name,
    lm.membership_description,
    ms.total_members,
    ms.lgbtq_count,
    ms.prefer_not_to_say_count,
    ms.lgbtq_percent,
    ms.goalie_count,
    lm.valid_until - CURRENT_DATE AS days_to_expiration,
        CASE
            WHEN (lm.valid_until - CURRENT_DATE) < 0 THEN 'Expired'::text
            WHEN (lm.valid_until - CURRENT_DATE) <= 30 THEN 'Expiring Soon'::text
            WHEN (lm.valid_until - CURRENT_DATE) <= 90 THEN 'Expiring'::text
            ELSE 'Active'::text
        END AS expiration_status,
        CASE
            WHEN lm.is_lgbtq = true THEN 'LGBTQ+'::text
            WHEN lm.is_lgbtq = false THEN 'Ally'::text
            ELSE 'No Response'::text
        END AS lgbtq_status
   FROM latest_memberships lm
     JOIN membership_stats ms ON lm.membership_id = ms.membership_id
  ORDER BY lm.membership_id, lm.last_name, lm.first_name;
