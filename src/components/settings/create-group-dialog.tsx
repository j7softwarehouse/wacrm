'use client';

// ============================================================
// CreateGroupDialog — Settings → Groups → "Criar grupo".
//
// Cria um grupo de WhatsApp de verdade (POST /api/whatsapp/groups, que
// chama a UAZAPI) a partir de contatos já cadastrados no CRM. O
// servidor resolve o telefone de cada contato a partir do id — o
// diálogo nunca manda telefone no corpo da requisição.
//
// Contatos são carregados uma vez (RLS já escopa por conta, mesmo
// padrão de `deal-form.tsx`) e filtrados localmente pela busca — não
// há paginação porque a base de contatos de uma escola é pequena o
// bastante para caber em memória.
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Search, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';

const MAX_PARTICIPANTS = 50;

interface PickedContact {
  id: string;
  name: string | null;
  phone: string;
}

interface CreatedGroup {
  id: string;
  group_jid: string;
  name: string | null;
  avatar_url: string | null;
  enabled: boolean;
}

export function CreateGroupDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (group: CreatedGroup) => void;
}) {
  const t = useTranslations('Settings.groups');
  const [contacts, setContacts] = useState<PickedContact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Estado limpo a cada abertura — evita levar seleção/nome de uma
    // tentativa anterior (inclusive uma que deu erro) para a próxima.
    setName('');
    setSearch('');
    setSelected(new Set());
    setLoadingContacts(true);

    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('contacts')
        .select('id, name, phone')
        .order('name', { ascending: true });
      if (cancelled) return;
      if (error) {
        console.error('[CreateGroupDialog] contacts load error:', error.message);
        toast.error(t('createContactsLoadError'));
      } else {
        setContacts((data ?? []) as PickedContact[]);
      }
      setLoadingContacts(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, t]);

  const filteredContacts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return contacts;
    return contacts.filter(
      (c) =>
        (c.name ?? '').toLowerCase().includes(query) ||
        sanitizePhoneForMeta(c.phone).includes(sanitizePhoneForMeta(query)),
    );
  }, [contacts, search]);

  function toggleContact(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) {
        if (next.size >= MAX_PARTICIPANTS) return prev;
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const res = await fetch('/api/whatsapp/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), contactIds: Array.from(selected) }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || t('createError'));
        return;
      }

      const invitedPhones = (payload.invitedPhones ?? []) as string[];
      if (invitedPhones.length > 0) {
        toast.warning(t('createInvitedWarning', { count: invitedPhones.length }));
      }
      toast.success(t('createSuccess'));
      onCreated(payload.group as CreatedGroup);
      onOpenChange(false);
    } catch (err) {
      console.error('[CreateGroupDialog] submit error:', err);
      toast.error(t('createError'));
    } finally {
      setSubmitting(false);
    }
  }

  const trimmedName = name.trim();
  const canSubmit =
    !submitting && trimmedName.length > 0 && trimmedName.length <= 100 && selected.size > 0;

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('createDialogTitle')}</DialogTitle>
          <DialogDescription>
            {t('createSelectedCount', { count: selected.size, max: MAX_PARTICIPANTS })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="create-group-name">{t('createNameLabel')}</Label>
            <Input
              id="create-group-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('createNamePlaceholder')}
              maxLength={100}
              disabled={submitting}
            />
          </div>

          <div className="space-y-1.5">
            <div className="relative">
              <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('createSearchPlaceholder')}
                className="pl-8"
                disabled={submitting}
              />
            </div>

            {loadingContacts ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="text-primary size-5 animate-spin" />
              </div>
            ) : filteredContacts.length === 0 ? (
              <div className="text-muted-foreground flex flex-col items-center gap-2 py-8 text-center text-sm">
                <Users className="size-5" />
                {t('createContactsEmpty')}
              </div>
            ) : (
              <ScrollArea className="h-64 rounded-md border border-border">
                <div className="divide-y divide-border">
                  {filteredContacts.map((contact) => {
                    const checked = selected.has(contact.id);
                    return (
                      <label
                        key={contact.id}
                        className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted"
                      >
                        <Checkbox
                          checked={checked}
                          disabled={submitting || (!checked && selected.size >= MAX_PARTICIPANTS)}
                          onCheckedChange={(next) => toggleContact(contact.id, next === true)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-foreground">
                            {contact.name || contact.phone}
                          </span>
                          {contact.name ? (
                            <span className="text-muted-foreground block truncate text-xs">
                              {contact.phone}
                            </span>
                          ) : null}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t('cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : null}
            {submitting ? t('createSubmitting') : t('createSubmit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
