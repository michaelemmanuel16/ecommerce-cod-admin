import { useEffect, useState } from 'react';
import { Button, Input, Modal, useToast } from '../../components/ui-v2';
import { inventoryService } from '../../services/inventory.service';
import { apiErrorMessage } from '../../utils/apiError';

interface OwnStoreModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

/** "Set up own store" (F-652): one name and an optional address. The API allows one own store per business. */
export function OwnStoreModal({ open, onClose, onCreated }: OwnStoreModalProps) {
  const say = useToast();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName('');
    setAddress('');
    setError(undefined);
    setSaving(false);
  }, [open]);

  const save = async () => {
    if (!name.trim()) {
      setError('Give the store a name');
      return;
    }
    setSaving(true);
    try {
      await inventoryService.createOwnStore({ name: name.trim(), ...(address.trim() && { address: address.trim() }) });
      say(`${name.trim()} is set up as your own store`);
      onCreated();
    } catch (e) {
      setSaving(false);
      setError(apiErrorMessage(e, 'The store could not be set up.'));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Set up own store"
      description="A place where you keep stock yourself. It gets a card, and you can count it and move stock out of it."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={saving} onClick={() => void save()}>Set up store</Button>
        </>
      }
    >
      <form noValidate onSubmit={(e) => { e.preventDefault(); void save(); }} className="stockform">
        <Input label="Store name" placeholder="Accra shop" value={name} error={error} autoComplete="off" onChange={(e) => { setName(e.target.value); setError(undefined); }} />
        <Input label="Town or address" optional value={address} autoComplete="off" onChange={(e) => setAddress(e.target.value)} />
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
