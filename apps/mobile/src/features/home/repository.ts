import { supabase } from '../../lib/supabase';
import { mapHomeTrip, type HomeTrip } from './model';

export async function loadLatestHomeTrip(driverId: string): Promise<HomeTrip | null> {
  const { data, error } = await supabase
    .from('trip_records')
    .select('id,started_at,route,purpose,vehicle_id,dvir_summary')
    .eq('driver_id', driverId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load trip information: ${error.message}`);
  }
  return mapHomeTrip(data);
}
