'use client';

// ============================================================
// CreateGroupDialog — Settings → Groups → "Criar grupo".
//
// Cria um grupo de WhatsApp de verdade (POST /api/whatsapp/groups, que
// chama a UAZAPI) a partir de contatos já cadastrados no CRM. O
// servidor resolve o telefone de cada contato a partir do id — o
// diálogo nunca manda telefone no corpo da requisição.
//
// A busca é feita no BANCO (debounce de 300ms), nunca carregando todos
// os contatos da conta pro navegador. Antes disso, o diálogo listava
// tudo de uma vez com `.select().order('name')` sem paginação — o
// PostgREST corta qualquer select sem `.range()` em 1000 linhas por
// padrão, e esta conta tem 8.600+ contatos. Na prática, qualquer nome
// que caísse depois da linha 1000 em ordem alfabética nunca chegava a
// ser carregado, e a busca "não achava" o contato mesmo digitando
// certo. Ver `import-modal.tsx` (mesma lição, resolvida lá antes) e a
// página de Contatos (`contacts/page.tsx`), de onde este padrão de
// busca por `.or(ilike)` + `.range()` foi copiado.
// ============================================================

import { useEffect, useState } from 'react';
import { Loader2, Search, Users, X } from 'lucide-react';
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

/** Quantos contatos a busca traz por vez — não é o limite de membros do
 *  grupo (`MAX_PARTICIPANTS`, abaixo), só quantas linhas a UI mostra
 *  por consulta. */
export const CONTACT_SEARCH_LIMIT = 50;

/**
 * Tira da busca digitada os caracteres que têm significado especial no
 * filtro `.or()` do PostgREST (`,` separa condições, `()` agrupa) ou
 * que são curingas do ILIKE (`%`, `_`) — mais `*`, porque vários nomes
 * salvos começam com "***". Nenhum desses é algo que alguém digita de
 * propósito pra achar um contato, então REMOVER (em vez de tentar
 * escapar) mantém o filtro sempre bem-formado sem precisar reproduzir
 * a sintaxe exata de escape do PostgREST.
 */
export function sanitizeForIlikeFilter(raw: string): string {
  return raw.replace(/[,()%_*]/g, '');
}

export interface ContactSearchFilter {
  /** `null` quando não sobra nada pesquisável (busca vazia, ou só com
   *  caracteres removidos) — o chamador não deve bater no banco. */
  orFilter: string | null;
}

/**
 * Monta o filtro `.or()` pra busca server-side de contatos — substitui
 * o filtro local em memória (`matchesContactSearch`, removido), que só
 * enxergava os contatos já carregados no navegador. Mesma semântica
 * dupla de antes: nome bate por substring (mantém espaço/hífen, só tira
 * o que quebraria o filtro); telefone bate só pelos dígitos da busca, e
 * só entra como condição quando a busca TEM algum dígito — sem essa
 * guarda, uma busca só de letras viraria string vazia pro lado do
 * telefone, e `ilike.%%` bate com QUALQUER telefone.
 */
export function buildContactSearchFilter(rawQuery: string): ContactSearchFilter {
  const nameTerm = sanitizeForIlikeFilter(rawQuery.trim());
  const phoneTerm = sanitizePhoneForMeta(rawQuery);

  const conditions: string[] = [];
  if (nameTerm) conditions.push(`name.ilike.%${nameTerm}%`);
  if (phoneTerm) conditions.push(`phone.ilike.%${phoneTerm}%`);

  return { orFilter: conditions.length > 0 ? conditions.join(',') : null };
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
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [results, setResults] = useState<PickedContact[]>([]);
  const [resultsTotalCount, setResultsTotalCount] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  // Map (não Set) porque a linha de um contato selecionado pode não
  // estar nos `results` da busca atual — precisamos do nome/telefone
  // dele à mão pra desenhar o chip removível mesmo assim.
  const [selected, setSelected] = useState<Map<string, PickedContact>>(new Map());
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Estado limpo a cada abertura — evita levar seleção/nome/busca de
    // uma tentativa anterior (inclusive uma que deu erro) para a
    // próxima.
    setName('');
    setSearch('');
    setDebouncedSearch('');
    setResults([]);
    setResultsTotalCount(null);
    setSelected(new Map());
  }, [open]);

  // Debounce: só dispara a busca no banco 300ms depois que a pessoa
  // parou de digitar, pra não bater uma consulta por tecla.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!open) return;

    const { orFilter } = buildContactSearchFilter(debouncedSearch);
    if (!orFilter) {
      setResults([]);
      setResultsTotalCount(null);
      setSearching(false);
      return;
    }

    setSearching(true);
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data, error, count } = await supabase
        .from('contacts')
        .select('id, name, phone', { count: 'exact' })
        .or(orFilter)
        .order('name', { ascending: true })
        .limit(CONTACT_SEARCH_LIMIT);
      if (cancelled) return;
      if (error) {
        console.error('[CreateGroupDialog] contacts search error:', error.message);
        toast.error(t('createContactsLoadError'));
        setResults([]);
        setResultsTotalCount(null);
      } else {
        setResults((data ?? []) as PickedContact[]);
        setResultsTotalCount(count ?? 0);
      }
      setSearching(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, debouncedSearch, t]);

  function toggleContact(contact: PickedContact, checked: boolean) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (checked) {
        if (next.size >= MAX_PARTICIPANTS) return prev;
        next.set(contact.id, contact);
      } else {
        next.delete(contact.id);
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
        body: JSON.stringify({ name: name.trim(), contactIds: Array.from(selected.keys()) }),
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

          {selected.size > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {Array.from(selected.values()).map((contact) => (
                <span
                  key={contact.id}
                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-muted py-1 pr-1.5 pl-3 text-xs font-medium text-foreground"
                >
                  <span className="max-w-40 truncate">{contact.name || contact.phone}</span>
                  <button
                    type="button"
                    onClick={() => toggleContact(contact, false)}
                    disabled={submitting}
                    aria-label={t('createRemoveSelected', {
                      name: contact.name || contact.phone,
                    })}
                    className="text-muted-foreground hover:bg-background hover:text-foreground rounded-full p-0.5 disabled:pointer-events-none"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

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

            {!debouncedSearch.trim() ? (
              <div className="text-muted-foreground flex flex-col items-center gap-2 py-8 text-center text-sm">
                <Search className="size-5" />
                {t('createSearchPrompt')}
              </div>
            ) : searching ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="text-primary size-5 animate-spin" />
              </div>
            ) : results.length === 0 ? (
              <div className="text-muted-foreground flex flex-col items-center gap-2 py-8 text-center text-sm">
                <Users className="size-5" />
                {t('createContactsEmpty')}
              </div>
            ) : (
              <>
                <ScrollArea className="h-64 rounded-md border border-border">
                  <div className="divide-y divide-border">
                    {results.map((contact) => {
                      const checked = selected.has(contact.id);
                      return (
                        <label
                          key={contact.id}
                          className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted"
                        >
                          <Checkbox
                            checked={checked}
                            disabled={
                              submitting || (!checked && selected.size >= MAX_PARTICIPANTS)
                            }
                            onCheckedChange={(next) => toggleContact(contact, next === true)}
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
                {resultsTotalCount !== null && resultsTotalCount > results.length ? (
                  <p className="text-muted-foreground text-xs">
                    {t('createSearchMoreResults', {
                      shown: results.length,
                      total: resultsTotalCount,
                    })}
                  </p>
                ) : null}
              </>
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
