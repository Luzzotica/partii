import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    { error: 'Per-course checkout has been removed. Use /api/checkout/offers/[slug] instead.' },
    { status: 410 }
  );
}
