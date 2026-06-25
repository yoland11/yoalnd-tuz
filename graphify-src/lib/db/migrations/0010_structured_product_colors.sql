ALTER TABLE "cart_items" ADD COLUMN IF NOT EXISTS "selected_color_data" jsonb;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "selected_color_data" jsonb;

UPDATE "products"
SET "colors" = (
  SELECT COALESCE(jsonb_agg(
    CASE
      WHEN jsonb_typeof(value) = 'object' THEN value
      ELSE jsonb_build_object(
        'name',
        value #>> '{}',
        'hex',
        CASE value #>> '{}'
          WHEN 'أسود' THEN '#000000'
          WHEN 'أبيض' THEN '#FFFFFF'
          WHEN 'رمادي' THEN '#808080'
          WHEN 'فضي' THEN '#C0C0C0'
          WHEN 'ذهبي' THEN '#D4AF37'
          WHEN 'شامبين' THEN '#F7E7CE'
          WHEN 'بيج' THEN '#F5F5DC'
          WHEN 'عاجي' THEN '#FFFFF0'
          WHEN 'بني' THEN '#8B4513'
          WHEN 'كراميل' THEN '#C68E17'
          WHEN 'أحمر' THEN '#FF0000'
          WHEN 'خمري' THEN '#800020'
          WHEN 'وردي' THEN '#FFC0CB'
          WHEN 'زهري فاتح' THEN '#F8BBD0'
          WHEN 'بنفسجي' THEN '#800080'
          WHEN 'لافندر' THEN '#E6E6FA'
          WHEN 'أزرق' THEN '#0000FF'
          WHEN 'كحلي' THEN '#000080'
          WHEN 'سماوي' THEN '#87CEEB'
          WHEN 'تركواز' THEN '#40E0D0'
          WHEN 'أخضر' THEN '#008000'
          WHEN 'زيتي' THEN '#808000'
          WHEN 'نعناعي' THEN '#98FF98'
          WHEN 'أصفر' THEN '#FFFF00'
          WHEN 'برتقالي' THEN '#FFA500'
          WHEN 'خوخي' THEN '#FFE5B4'
          WHEN 'مرجاني' THEN '#FF7F50'
          WHEN 'ذهبي وردي' THEN '#B76E79'
          WHEN 'نحاسي' THEN '#B87333'
          WHEN 'عنابي' THEN '#4A0000'
          WHEN 'فستقي' THEN '#93C572'
          WHEN 'موف' THEN '#E0B0FF'
          WHEN 'فيروزي غامق' THEN '#008B8B'
          WHEN 'رمادي غامق' THEN '#2F2F2F'
          WHEN 'أوف وايت' THEN '#FAF9F6'
          ELSE CASE
            WHEN (value #>> '{}') ~* '^#?[0-9a-f]{6}$'
              THEN CASE
                WHEN left(value #>> '{}', 1) = '#' THEN upper(value #>> '{}')
                ELSE '#' || upper(value #>> '{}')
              END
            ELSE ''
          END
        END
      )
    END
  ), '[]'::jsonb)
  FROM jsonb_array_elements("products"."colors") AS value
)
WHERE jsonb_typeof("colors") = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements("products"."colors") AS value
    WHERE jsonb_typeof(value) = 'string'
  );

UPDATE "cart_items"
SET "selected_color_data" = jsonb_build_object(
  'name',
  "selected_color",
  'hex',
  CASE "selected_color"
    WHEN 'أسود' THEN '#000000'
    WHEN 'أبيض' THEN '#FFFFFF'
    WHEN 'رمادي' THEN '#808080'
    WHEN 'فضي' THEN '#C0C0C0'
    WHEN 'ذهبي' THEN '#D4AF37'
    WHEN 'شامبين' THEN '#F7E7CE'
    WHEN 'بيج' THEN '#F5F5DC'
    WHEN 'عاجي' THEN '#FFFFF0'
    WHEN 'بني' THEN '#8B4513'
    WHEN 'كراميل' THEN '#C68E17'
    WHEN 'أحمر' THEN '#FF0000'
    WHEN 'خمري' THEN '#800020'
    WHEN 'وردي' THEN '#FFC0CB'
    WHEN 'زهري فاتح' THEN '#F8BBD0'
    WHEN 'بنفسجي' THEN '#800080'
    WHEN 'لافندر' THEN '#E6E6FA'
    WHEN 'أزرق' THEN '#0000FF'
    WHEN 'كحلي' THEN '#000080'
    WHEN 'سماوي' THEN '#87CEEB'
    WHEN 'تركواز' THEN '#40E0D0'
    WHEN 'أخضر' THEN '#008000'
    WHEN 'زيتي' THEN '#808000'
    WHEN 'نعناعي' THEN '#98FF98'
    WHEN 'أصفر' THEN '#FFFF00'
    WHEN 'برتقالي' THEN '#FFA500'
    WHEN 'خوخي' THEN '#FFE5B4'
    WHEN 'مرجاني' THEN '#FF7F50'
    WHEN 'ذهبي وردي' THEN '#B76E79'
    WHEN 'نحاسي' THEN '#B87333'
    WHEN 'عنابي' THEN '#4A0000'
    WHEN 'فستقي' THEN '#93C572'
    WHEN 'موف' THEN '#E0B0FF'
    WHEN 'فيروزي غامق' THEN '#008B8B'
    WHEN 'رمادي غامق' THEN '#2F2F2F'
    WHEN 'أوف وايت' THEN '#FAF9F6'
    ELSE ''
  END
)
WHERE "selected_color_data" IS NULL
  AND NULLIF(trim(COALESCE("selected_color", '')), '') IS NOT NULL;

UPDATE "order_items"
SET "selected_color_data" = jsonb_build_object(
  'name',
  "selected_color",
  'hex',
  CASE "selected_color"
    WHEN 'أسود' THEN '#000000'
    WHEN 'أبيض' THEN '#FFFFFF'
    WHEN 'رمادي' THEN '#808080'
    WHEN 'فضي' THEN '#C0C0C0'
    WHEN 'ذهبي' THEN '#D4AF37'
    WHEN 'شامبين' THEN '#F7E7CE'
    WHEN 'بيج' THEN '#F5F5DC'
    WHEN 'عاجي' THEN '#FFFFF0'
    WHEN 'بني' THEN '#8B4513'
    WHEN 'كراميل' THEN '#C68E17'
    WHEN 'أحمر' THEN '#FF0000'
    WHEN 'خمري' THEN '#800020'
    WHEN 'وردي' THEN '#FFC0CB'
    WHEN 'زهري فاتح' THEN '#F8BBD0'
    WHEN 'بنفسجي' THEN '#800080'
    WHEN 'لافندر' THEN '#E6E6FA'
    WHEN 'أزرق' THEN '#0000FF'
    WHEN 'كحلي' THEN '#000080'
    WHEN 'سماوي' THEN '#87CEEB'
    WHEN 'تركواز' THEN '#40E0D0'
    WHEN 'أخضر' THEN '#008000'
    WHEN 'زيتي' THEN '#808000'
    WHEN 'نعناعي' THEN '#98FF98'
    WHEN 'أصفر' THEN '#FFFF00'
    WHEN 'برتقالي' THEN '#FFA500'
    WHEN 'خوخي' THEN '#FFE5B4'
    WHEN 'مرجاني' THEN '#FF7F50'
    WHEN 'ذهبي وردي' THEN '#B76E79'
    WHEN 'نحاسي' THEN '#B87333'
    WHEN 'عنابي' THEN '#4A0000'
    WHEN 'فستقي' THEN '#93C572'
    WHEN 'موف' THEN '#E0B0FF'
    WHEN 'فيروزي غامق' THEN '#008B8B'
    WHEN 'رمادي غامق' THEN '#2F2F2F'
    WHEN 'أوف وايت' THEN '#FAF9F6'
    ELSE ''
  END
)
WHERE "selected_color_data" IS NULL
  AND NULLIF(trim(COALESCE("selected_color", '')), '') IS NOT NULL;
