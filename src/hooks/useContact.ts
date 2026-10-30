/** The signed-in customer's name, phone and email from their profile, for a
 *  booking or order form (ServiceBookingPage, ShopPage); editable. */
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';

export function useContact() {
  const { user } = useAuth();
  const [contact, setContact] = useState({ name: '', phone: '', email: '' });
  useEffect(() => {
    if (!user) return;
    supabase.from('profiles').select('first_name, last_name, phone, email').eq('user_id', user.id).maybeSingle().then(({ data }) => {
      if (data) setContact(c => ({ name: c.name || [data.first_name, data.last_name].filter(Boolean).join(' '), phone: c.phone || data.phone || '', email: c.email || data.email || user.email || '' }));
    });
  }, [user]);
  return [contact, setContact] as const;
}
