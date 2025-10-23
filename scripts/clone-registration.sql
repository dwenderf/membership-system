-- Clone Registration Script
-- Usage: Update the variables at the top, then run this script
-- This will copy an existing registration and all its categories with a new name

-- ============================================
-- CONFIGURATION: UPDATE THESE VALUES
-- ============================================
DO $$
DECLARE
  -- SOURCE: The registration to copy from
  source_registration_id UUID := 'YOUR-SOURCE-REGISTRATION-ID-HERE'; -- Replace with actual UUID

  -- TARGET: The new registration details
  new_registration_name TEXT := 'New Registration Name'; -- Replace with desired name

  -- VARIABLES: Don't modify these
  new_registration_id UUID;
  category_record RECORD;
  new_category_id UUID;
BEGIN

  -- ============================================
  -- STEP 1: Clone the registration
  -- ============================================
  RAISE NOTICE '================================================';
  RAISE NOTICE 'Cloning registration from source: %', source_registration_id;
  RAISE NOTICE '================================================';

  -- Insert new registration based on source
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
    new_registration_name, -- Use the new name
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
    NOW(), -- New created_at
    NOW(), -- New updated_at
    updated_by
  FROM registrations
  WHERE id = source_registration_id
  RETURNING id INTO new_registration_id;

  IF new_registration_id IS NULL THEN
    RAISE EXCEPTION 'Failed to create new registration. Source registration ID not found: %', source_registration_id;
  END IF;

  RAISE NOTICE 'Created new registration: % (ID: %)', new_registration_name, new_registration_id;

  -- ============================================
  -- STEP 2: Clone all registration categories
  -- ============================================
  RAISE NOTICE '';
  RAISE NOTICE 'Cloning registration categories...';
  RAISE NOTICE '------------------------------------------------';

  FOR category_record IN
    SELECT * FROM registration_categories
    WHERE registration_id = source_registration_id
    ORDER BY sort_order
  LOOP
    -- Insert new category based on source
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
      new_registration_id, -- Use new registration ID
      category_record.category_id,
      category_record.custom_name,
      category_record.price,
      category_record.max_capacity,
      category_record.accounting_code,
      category_record.required_membership_id,
      category_record.sort_order,
      NOW() -- New created_at
    )
    RETURNING id INTO new_category_id;

    RAISE NOTICE 'Cloned category: % (Price: $%, Max Capacity: %) -> New ID: %',
      COALESCE(category_record.custom_name, '(using category_id)'),
      (category_record.price::DECIMAL / 100),
      COALESCE(category_record.max_capacity::TEXT, 'unlimited'),
      new_category_id;
  END LOOP;

  -- ============================================
  -- STEP 3: Summary
  -- ============================================
  RAISE NOTICE '';
  RAISE NOTICE '================================================';
  RAISE NOTICE 'SUCCESS! Registration cloned successfully';
  RAISE NOTICE '================================================';
  RAISE NOTICE 'Source Registration ID: %', source_registration_id;
  RAISE NOTICE 'New Registration ID: %', new_registration_id;
  RAISE NOTICE 'New Registration Name: %', new_registration_name;
  RAISE NOTICE 'Categories Cloned: %', (SELECT COUNT(*) FROM registration_categories WHERE registration_id = new_registration_id);
  RAISE NOTICE '';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '  - Review the new registration in the admin panel';
  RAISE NOTICE '  - Adjust dates, pricing, or capacity as needed';
  RAISE NOTICE '  - Set is_active = true when ready to publish';
  RAISE NOTICE '================================================';

END $$;
