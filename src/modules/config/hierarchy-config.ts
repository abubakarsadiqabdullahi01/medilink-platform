import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { recordAudit } from '@/lib/audit';
import { HttpError } from '@/lib/http/errors';
import {
  categoryNameProblem,
  levelKey,
  levelProblem,
  registrationCategoryKey,
  type LevelProblem,
} from './hierarchy';

/**
 * The professional hierarchy, entered by the people who own it (CFG-04).
 *
 * Levels belong to a profession and are ranked within it; registration categories
 * are platform-wide and say whether somebody on one needs supervision. Neither is
 * ever deleted: a shift or a practitioner that holds one keeps what it meant, so a
 * list that is wrong is retired and a better one added. Nothing here proposes what
 * the levels are.
 */

const OWNER = 'compliance';

const MESSAGES: Record<LevelProblem, string> = {
  name: 'Give it a name, between 2 and 80 characters.',
  rank: 'Give it a rank: a whole number from 1 to 1000, lowest for the most junior. Leave gaps (10, 20, 30) so another can be added between.',
};

export const HierarchyErrors = {
  invalid: (problem: LevelProblem) => new HttpError('level_invalid', MESSAGES[problem], 422),
  categoryNotFound: () => new HttpError('category_not_found', 'There is no such profession.', 404),
  levelNotFound: () => new HttpError('level_not_found', 'There is no such level.', 404),
  registrationCategoryNotFound: () =>
    new HttpError('registration_category_not_found', 'There is no such registration category.', 404),
  rankTaken: () =>
    new HttpError('level_rank_taken', 'Another level of that profession already has that rank.', 409),
  nameTaken: () =>
    new HttpError('level_name_taken', 'That profession already has a level by that name.', 409),
  categoryNameTaken: () =>
    new HttpError('category_name_taken', 'There is already a registration category by that name.', 409),
};

export interface CadreLevelView {
  id: string;
  professionalCategoryId: string;
  key: string;
  name: string;
  rank: number;
  isActive: boolean;
}

export interface RegistrationCategoryView {
  id: string;
  key: string;
  name: string;
  supervisionRequired: boolean;
  isActive: boolean;
}

const levelView = (row: CadreLevelView): CadreLevelView => ({
  id: row.id,
  professionalCategoryId: row.professionalCategoryId,
  key: row.key,
  name: row.name,
  rank: row.rank,
  isActive: row.isActive,
});

const categoryView = (row: RegistrationCategoryView): RegistrationCategoryView => ({
  id: row.id,
  key: row.key,
  name: row.name,
  supervisionRequired: row.supervisionRequired,
  isActive: row.isActive,
});

export async function createCadreLevel(input: {
  professionalCategoryId: string;
  name: string;
  rank: number;
  actorId: string;
}): Promise<CadreLevelView> {
  const problem = levelProblem({ name: input.name, rank: input.rank });
  if (problem) throw HierarchyErrors.invalid(problem);

  const category = await prisma.professionalCategory.findUnique({
    where: { id: input.professionalCategoryId },
    select: { id: true, key: true },
  });
  if (!category) throw HierarchyErrors.categoryNotFound();

  const key = levelKey(category.key, input.name);

  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.cadreLevel.create({
        data: {
          professionalCategoryId: category.id,
          key,
          name: input.name.trim(),
          rank: input.rank,
          owner: OWNER,
        },
      });
      await recordAudit(tx, {
        action: 'cadre_level.created',
        entityType: 'config.cadre_levels',
        entityId: created.id,
        actorId: input.actorId,
        scopeType: 'PLATFORM',
        after: levelView(created),
      });
      return levelView(created);
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      // Which of the two unique rules it was: the key (same name) or the rank.
      const target = JSON.stringify(error.meta?.target ?? '');
      throw target.includes('rank') ? HierarchyErrors.rankTaken() : HierarchyErrors.nameTaken();
    }
    throw error;
  }
}

export async function setCadreLevelActive(input: {
  id: string;
  active: boolean;
  actorId: string;
}): Promise<CadreLevelView> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.cadreLevel.findUnique({ where: { id: input.id } });
    if (!existing) throw HierarchyErrors.levelNotFound();

    const updated = await tx.cadreLevel.update({ where: { id: input.id }, data: { isActive: input.active } });
    await recordAudit(tx, {
      action: input.active ? 'cadre_level.restored' : 'cadre_level.retired',
      entityType: 'config.cadre_levels',
      entityId: updated.id,
      actorId: input.actorId,
      scopeType: 'PLATFORM',
      before: { isActive: existing.isActive },
      after: { isActive: updated.isActive },
    });
    return levelView(updated);
  });
}

export async function createRegistrationCategory(input: {
  name: string;
  supervisionRequired: boolean;
  actorId: string;
}): Promise<RegistrationCategoryView> {
  if (categoryNameProblem(input.name)) throw HierarchyErrors.invalid('name');

  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.registrationCategory.create({
        data: {
          key: registrationCategoryKey(input.name),
          name: input.name.trim(),
          supervisionRequired: input.supervisionRequired,
          owner: OWNER,
        },
      });
      await recordAudit(tx, {
        action: 'registration_category.created',
        entityType: 'config.registration_categories',
        entityId: created.id,
        actorId: input.actorId,
        scopeType: 'PLATFORM',
        after: categoryView(created),
      });
      return categoryView(created);
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw HierarchyErrors.categoryNameTaken();
    }
    throw error;
  }
}

export async function setRegistrationCategoryActive(input: {
  id: string;
  active: boolean;
  actorId: string;
}): Promise<RegistrationCategoryView> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.registrationCategory.findUnique({ where: { id: input.id } });
    if (!existing) throw HierarchyErrors.registrationCategoryNotFound();

    const updated = await tx.registrationCategory.update({ where: { id: input.id }, data: { isActive: input.active } });
    await recordAudit(tx, {
      action: input.active ? 'registration_category.restored' : 'registration_category.retired',
      entityType: 'config.registration_categories',
      entityId: updated.id,
      actorId: input.actorId,
      scopeType: 'PLATFORM',
      before: { isActive: existing.isActive },
      after: { isActive: updated.isActive },
    });
    return categoryView(updated);
  });
}

export interface HierarchyOverview {
  professions: { id: string; key: string; name: string; levels: CadreLevelView[] }[];
  registrationCategories: RegistrationCategoryView[];
}

/** Every profession with its levels lowest first, retired ones included, and every registration category. */
export async function hierarchyOverview(): Promise<HierarchyOverview> {
  const [professions, categories] = await Promise.all([
    prisma.professionalCategory.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        key: true,
        name: true,
        cadreLevels: { orderBy: { rank: 'asc' } },
      },
    }),
    prisma.registrationCategory.findMany({ orderBy: { name: 'asc' } }),
  ]);

  return {
    professions: professions.map((profession) => ({
      id: profession.id,
      key: profession.key,
      name: profession.name,
      levels: profession.cadreLevels.map(levelView),
    })),
    registrationCategories: categories.map(categoryView),
  };
}
