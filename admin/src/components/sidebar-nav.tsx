'use client';

import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Role } from '../lib/api';
import { groupOf, navigationGroupsFor } from '../lib/navigation';

const STORAGE_KEY = 'hc.admin.nav';

/**
 * Navigation du dashboard : **icônes + groupes dépliants**.
 *
 * Treize modules à plat font une liste qu'on parcourt des yeux à chaque fois.
 * Regroupés par moment de la journée — le comptoir, le suivi, le pilotage —
 * l'agent ne garde ouvert que ce qu'il utilise.
 *
 * Trois règles qui rendent le repli supportable :
 *  1. **Le choix de repli de l'agent est respecté**, même sur le groupe de la
 *     page ouverte — le rouvrir de force sous ses yeux après qu'il l'a replié
 *     le contredirait. Un point discret sur l'intitulé dit « il y a la page
 *     en cours là-dedans », sans forcer l'affichage.
 *  2. **L'état est mémorisé** (localStorage) : un agent qui replie « Pilotage »
 *     le matin ne doit pas le retrouver ouvert après chaque navigation.
 *  3. **Un groupe vidé par les droits ne s'affiche pas** — pas d'intitulé qui
 *     s'ouvre sur rien.
 */
export function SidebarNav({ role, pathname }: { role: Role; pathname: string }) {
  const groups = navigationGroupsFor(role);
  const activeGroup = groupOf(pathname);

  // Premier rendu : tout ouvert. On corrige juste après avec la préférence
  // enregistrée, plutôt que de lire localStorage pendant le rendu serveur —
  // ce qui produirait une hydratation incohérente.
  const [collapsed, setCollapsed] = useState<string[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setCollapsed(JSON.parse(stored) as string[]);
    } catch {
      // Stockage indisponible (navigation privée) : on reste tout ouvert.
    }
  }, []);

  const toggle = (id: string) => {
    setCollapsed((current) => {
      const next = current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [...current, id];
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* sans stockage, le choix vaut pour la session en cours */
      }
      return next;
    });
  };

  return (
    <nav className="space-y-4">
      {groups.map((group) => {
        // Le repli choisi par l'agent est respecté, même sur son propre groupe
        // actif : `hasActive` n'allume que le point, jamais une réouverture forcée.
        const open = !collapsed.includes(group.id);
        const hasActive = group.id === activeGroup;
        const sectionId = `nav-${group.id}`;

        return (
          <div key={group.id}>
            <button
              onClick={() => toggle(group.id)}
              aria-expanded={open}
              aria-controls={sectionId}
              className="flex w-full items-center gap-2 rounded-sm px-3 py-1.5 text-caption uppercase tracking-wider text-white/45 transition hover:text-white/80"
            >
              <span className="flex-1 text-left">{group.label}</span>
              {!open && hasActive ? (
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-secondary"
                />
              ) : null}
              <ChevronDown
                size={14}
                aria-hidden
                className={`transition-transform duration-200 ${open ? '' : '-rotate-90'}`}
              />
            </button>

            {/*
              `grid-rows-[1fr] → [0fr]` plutôt qu'un `max-height` : **aucune
              hauteur plafond à deviner**, donc rien à corriger le jour où un
              groupe gagne une entrée de plus. L'enfant porte `overflow-hidden`,
              sans quoi la piste ne peut pas descendre sous sa taille minimale.

              ⚠️ Pour vérifier ce repli dans un navigateur piloté : le panneau
              masqué ne composite pas, donc **les transitions n'avancent
              jamais** et la hauteur semble figée. Mesurer après
              `document.getAnimations().forEach(a => a.finish())`, sinon on
              conclut à tort que l'animation est cassée.
            */}
            <div
              id={sectionId}
              className={`grid transition-[grid-template-rows] duration-200 ease-out ${
                open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
              }`}
            >
              <div className="overflow-hidden">
                <div className="ml-4 space-y-0.5 border-l border-white/10 pt-1 pl-2.5">
                  {group.items.map((item) => {
                    const active = pathname.startsWith(item.href);
                    const Icon = item.icon;

                    if (!item.ready) {
                      return (
                        <span
                          key={item.href}
                          title="Module à venir"
                          className="flex items-center gap-2.5 rounded-sm px-3 py-2 text-body text-white/30"
                        >
                          <Icon size={18} aria-hidden className="shrink-0" />
                          <span className="flex-1">{item.label}</span>
                          <span className="text-[10px] uppercase tracking-wider text-secondary/70">
                            à venir
                          </span>
                        </span>
                      );
                    }

                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        // Le filet doré marque la page ouverte : c'est le seul
                        // or du menu, donc il ne se confond avec rien.
                        className={`flex items-center gap-2.5 rounded-sm border-l-2 px-3 py-2 text-body transition ${
                          active
                            ? 'border-secondary bg-white/15 font-medium text-white'
                            : 'border-transparent text-white/70 hover:bg-white/10 hover:text-white'
                        }`}
                      >
                        <Icon size={18} aria-hidden className="shrink-0" />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </nav>
  );
}
