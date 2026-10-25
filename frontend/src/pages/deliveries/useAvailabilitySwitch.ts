import { useCallback } from 'react';
import { useToast } from '../../components/ui-v2';
import { deliveryPartnersService } from '../../services/delivery-partners.service';
import { apiErrorMessage } from '../../utils/apiError';

/** Turns a partner's availability on or off and says so. Resolves true when the server accepted it (the caller then reloads). */
export function useAvailabilitySwitch() {
  const say = useToast();
  return useCallback(async (partner: { id: number; name: string }, on: boolean): Promise<boolean> => {
    try {
      await deliveryPartnersService.setAvailability(partner.id, on);
      say(on ? `${partner.name} is available for new orders` : `${partner.name} is unavailable for new orders`);
      return true;
    } catch (e) {
      say(apiErrorMessage(e, 'The availability could not be changed.'));
      return false;
    }
  }, [say]);
}
