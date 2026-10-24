import type { PartnerDataSource, PartnerDetail } from '../../services/delivery-partners.service';

/** The editable fields of the Fees tab, as the form holds them. */
export interface Fields {
  daysToPay: string;
  dataSource: PartnerDataSource;
  isTrial: boolean;
  baseTown: string;
  vehicleType: string;
  vehicleId: string;
}

export const fieldsOf = (p: PartnerDetail): Fields => ({
  daysToPay: String(p.profile.daysToPay),
  dataSource: p.profile.dataSource,
  isTrial: p.profile.isTrial,
  baseTown: p.profile.baseTown ?? '',
  vehicleType: p.vehicleType ?? '',
  vehicleId: p.vehicleId ?? '',
});
