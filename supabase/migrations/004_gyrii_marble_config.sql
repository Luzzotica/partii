-- Add gyrii marble config to profiles for logged-in users
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS gyrii_marble_config JSONB DEFAULT NULL;

COMMENT ON COLUMN public.profiles.gyrii_marble_config IS 'Stores marble design: {designId, mainColor: {r,g,b}, secondaryColor: {r,g,b}}';
