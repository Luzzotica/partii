import { redirect } from 'next/navigation';

export default function LegacyCoursePurchaseRedirect() {
  redirect('/store');
}
