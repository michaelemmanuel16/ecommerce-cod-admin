import { Card, EmptyState } from '../../components/ui-v2';

/** The Security slot. M3-T64 fills it with the password form, sessions and the danger zone. */
export function SecurityTab() {
  return (
    <Card title="Security">
      <EmptyState title="Security settings are coming" text="Password, sessions and account deletion open here." />
    </Card>
  );
}
