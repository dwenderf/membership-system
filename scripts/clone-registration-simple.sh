#!/bin/bash

# Simple script to clone a registration
# Usage: ./scripts/clone-registration-simple.sh "source-uuid" "New Registration Name"

set -e

SOURCE_ID="$1"
NEW_NAME="$2"

if [ -z "$SOURCE_ID" ] || [ -z "$NEW_NAME" ]; then
  echo "Usage: $0 <source-registration-id> <new-registration-name>"
  echo ""
  echo "Example:"
  echo "  $0 '00000000-0000-0000-0000-000000000000' 'Scrimmage #8'"
  echo ""
  exit 1
fi

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
  echo "Error: DATABASE_URL environment variable is not set"
  echo "Please set it in your .env.local file or export it"
  exit 1
fi

echo "================================================"
echo "Cloning Registration"
echo "================================================"
echo "Source ID: $SOURCE_ID"
echo "New Name:  $NEW_NAME"
echo "================================================"
echo ""

# Run the SQL script with parameters
psql "$DATABASE_URL" << EOF
DO \$\$
DECLARE
  source_registration_id UUID := '$SOURCE_ID';
  new_registration_name TEXT := '$NEW_NAME';
  new_registration_id UUID;
  category_record RECORD;
  new_category_id UUID;
  category_count INTEGER := 0;
BEGIN

  -- Clone the registration
  INSERT INTO registrations (
    season_id,
    name,
    type,
    allow_discounts,
    is_active,
    presale_start_at,
    regular_start_at,
    registration_end_at,
    presale_code,
    allow_lgbtq_presale,
    allow_alternates,
    alternate_price,
    alternate_accounting_code,
    created_at,
    updated_at,
    updated_by
  )
  SELECT
    season_id,
    new_registration_name,
    type,
    allow_discounts,
    is_active,
    presale_start_at,
    regular_start_at,
    registration_end_at,
    presale_code,
    allow_lgbtq_presale,
    allow_alternates,
    alternate_price,
    alternate_accounting_code,
    NOW(),
    NOW(),
    updated_by
  FROM registrations
  WHERE id = source_registration_id
  RETURNING id INTO new_registration_id;

  IF new_registration_id IS NULL THEN
    RAISE EXCEPTION 'Source registration not found: %', source_registration_id;
  END IF;

  RAISE NOTICE '✓ Created registration: % (ID: %)', new_registration_name, new_registration_id;

  -- Clone all categories
  FOR category_record IN
    SELECT * FROM registration_categories
    WHERE registration_id = source_registration_id
    ORDER BY sort_order
  LOOP
    INSERT INTO registration_categories (
      registration_id,
      category_id,
      custom_name,
      price,
      max_capacity,
      accounting_code,
      required_membership_id,
      sort_order,
      created_at
    )
    VALUES (
      new_registration_id,
      category_record.category_id,
      category_record.custom_name,
      category_record.price,
      category_record.max_capacity,
      category_record.accounting_code,
      category_record.required_membership_id,
      category_record.sort_order,
      NOW()
    )
    RETURNING id INTO new_category_id;

    category_count := category_count + 1;

    RAISE NOTICE '  ✓ Cloned category #%: % (\$%, capacity: %)',
      category_count,
      COALESCE(category_record.custom_name, '(system category)'),
      (category_record.price::DECIMAL / 100),
      COALESCE(category_record.max_capacity::TEXT, 'unlimited');
  END LOOP;

  RAISE NOTICE '';
  RAISE NOTICE '================================================';
  RAISE NOTICE 'SUCCESS! Cloned % categories', category_count;
  RAISE NOTICE 'New Registration ID: %', new_registration_id;
  RAISE NOTICE '================================================';

END \$\$;
EOF

echo ""
echo "Done! Check the admin panel to review the new registration."
