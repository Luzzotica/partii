export type Course = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  cover_image_url: string | null;
  is_published: boolean;
  is_free: boolean;
  created_at: string;
  updated_at: string;
};

export type Offer = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  price_cents: number;
  currency: string;
  stripe_product_id: string | null;
  stripe_price_id: string | null;
  cover_image_url: string | null;
  is_published: boolean;
  created_at: string;
  updated_at: string;
};

export type OfferCourse = {
  offer_id: string;
  course_id: string;
  position: number;
};

export type CourseModule = {
  id: string;
  course_id: string;
  title: string;
  position: number;
};

export type Lesson = {
  id: string;
  module_id: string;
  title: string;
  position: number;
  content_json: unknown;
  mux_asset_id: string | null;
  mux_playback_id: string | null;
  mux_upload_id: string | null;
  video_duration_seconds: number | null;
};

export type LessonProgress = {
  user_id: string;
  lesson_id: string;
  course_id: string;
  completed: boolean;
  completed_at: string | null;
  watch_seconds: number;
  watch_percent: number;
};
