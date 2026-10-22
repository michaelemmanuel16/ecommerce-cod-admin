import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Card, Input, useToast } from '../../components/ui-v2';
import { accountService, type ProfileUser } from '../../services/account.service';
import { authService } from '../../services/auth.service';
import { API_URL } from '../../services/tokenRefresh';
import { useAuthStore } from '../../stores/authStore';

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PHOTO_MAX = 5 * 1024 * 1024;

const initials = (first = '', last = '') => `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase();
const joinName = (u: { firstName?: string; lastName?: string }) => [u.firstName, u.lastName].filter(Boolean).join(' ');
const photoSrc = (url: string) => (url.startsWith('/') ? `${API_URL}${url}` : url);
const apiMessage = (e: unknown, fallback: string) => (e as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;

/** Profile (M3-T63, F-1221, F-1222). Full name is one input; the server splits it on the last space. */
export function ProfileTab() {
  const say = useToast();
  const user = useAuthStore((s) => s.user);
  const roles = useAuthStore((s) => s.roles);
  const patchUser = useAuthStore((s) => s.patchUser);
  const [form, setForm] = useState(() => ({
    name: user ? joinName(user) : '',
    displayName: user?.displayName ?? '',
    email: user?.email ?? '',
    phone: user?.phoneNumber ?? '',
    currentPassword: '',
  }));
  const [saving, setSaving] = useState(false);
  const [busyPhoto, setBusyPhoto] = useState(false);
  const [error, setError] = useState<string>();
  const [savedEmail, setSavedEmail] = useState(user?.email ?? '');
  const fileRef = useRef<HTMLInputElement>(null);

  // The phone and display name come from /api/auth/me; the stored user may not have them yet.
  useEffect(() => {
    let live = true;
    authService.getMe().then(({ user: me }) => {
      if (!live) return;
      patchUser({ displayName: me.displayName, photoUrl: me.photoUrl, phoneNumber: me.phoneNumber });
      setForm((f) => ({ ...f, displayName: me.displayName ?? '', phone: me.phoneNumber ?? '' }));
      setSavedEmail(me.email);
    }).catch(() => undefined);
    return () => { live = false; };
  }, [patchUser]);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const emailChanged = form.email.trim().toLowerCase() !== savedEmail.toLowerCase();

  const apply = (saved: ProfileUser) => {
    patchUser({ firstName: saved.firstName, lastName: saved.lastName, displayName: saved.displayName, email: saved.email, phoneNumber: saved.phoneNumber, photoUrl: saved.photoUrl });
    return saved;
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    if (!form.name.trim()) return setError('Enter your name');
    setSaving(true);
    try {
      const saved = apply(await accountService.updateProfile({
        name: form.name,
        displayName: form.displayName,
        email: form.email,
        phone: form.phone,
        ...(emailChanged && { currentPassword: form.currentPassword }),
      }));
      setForm({ name: joinName(saved), displayName: saved.displayName ?? '', email: saved.email, phone: saved.phoneNumber ?? '', currentPassword: '' });
      setSavedEmail(saved.email);
      say('Profile saved');
    } catch (err) {
      setError(apiMessage(err, 'The profile could not be saved'));
    } finally {
      setSaving(false);
    }
  };

  const pickPhoto = async (file?: File) => {
    if (!file) return;
    if (!PHOTO_TYPES.includes(file.type) || file.size > PHOTO_MAX) return say('Use a JPEG, PNG or WebP photo up to 5 MB');
    setBusyPhoto(true);
    try {
      apply(await accountService.uploadPhoto(file));
      say('Photo changed');
    } catch (err) {
      say(apiMessage(err, 'The photo could not be uploaded'));
    } finally {
      setBusyPhoto(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removePhoto = async () => {
    setBusyPhoto(true);
    try {
      apply(await accountService.removePhoto());
      say('Photo removed');
    } catch (err) {
      say(apiMessage(err, 'The photo could not be removed'));
    } finally {
      setBusyPhoto(false);
    }
  };

  const since = user?.createdAt ? new Date(user.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const roleName = roles?.map((r) => r.name).join(' · ') || user?.role.replace('_', ' ');

  return (
    <Card title="Profile" aside="Only you see this">
      <form onSubmit={save}>
        <div className="proftop">
          <div className="avbig">
            {user?.photoUrl ? <img src={photoSrc(user.photoUrl)} alt="Your photo" /> : initials(user?.firstName, user?.lastName)}
          </div>
          <div>
            <b style={{ fontSize: 16 }}>{user?.displayName || (user && joinName(user))}</b>
            <small>{roleName}{since && ` · member since ${since}`}</small>
          </div>
          <div className="photoact">
            <input ref={fileRef} type="file" accept={PHOTO_TYPES.join(',')} hidden aria-label="Photo file" onChange={(e) => pickPhoto(e.target.files?.[0])} />
            <Button disabled={busyPhoto} onClick={() => fileRef.current?.click()}>Change photo</Button>
            {user?.photoUrl && <Button disabled={busyPhoto} onClick={removePhoto}>Remove photo</Button>}
          </div>
        </div>
        <div className="fields">
          <Input label="Full name" value={form.name} onChange={set('name')} autoComplete="name" />
          <Input label="Display name" value={form.displayName} onChange={set('displayName')} hint="Shown to your team in notes and assignments." />
          <Input label="Email" type="email" value={form.email} onChange={set('email')} autoComplete="email" />
          <Input label="Phone" type="tel" value={form.phone} onChange={set('phone')} placeholder="+233 24 000 0000" autoComplete="tel" />
          {emailChanged && (
            <Input
              label="Current password"
              type="password"
              className="full"
              value={form.currentPassword}
              onChange={set('currentPassword')}
              hint="Needed to change your email. We tell your old address about the change."
              autoComplete="current-password"
            />
          )}
          <Input label="Language" value="English" readOnly hint="CodAdmin is in English only." />
        </div>
        {error && (
          <div className="fl" style={{ padding: '10px 20px 0' }}>
            <p className="err" role="alert">{error}</p>
          </div>
        )}
        <div className="cardfoot">
          <Button variant="primary" type="submit" disabled={saving || (emailChanged && !form.currentPassword)}>Save profile</Button>
        </div>
      </form>
    </Card>
  );
}
