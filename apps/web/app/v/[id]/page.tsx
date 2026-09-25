/** F14 shared views: opens exactly the stored camera pose + focus; OG from the focused star when there is one. */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db } from '@/lib/server/app';
import { SceneIntent } from '@/ui/SceneIntent';

type Camera = { pos: [number, number, number]; quat: [number, number, number, number]; focus: string | null; t: number };

async function load(id: string) {
  if (!/^[0-9a-zA-Z]{10}$/.test(id)) return null;
  const [v] = await (await db()).query<{ camera: Camera; bake_version: string }>('select camera, bake_version from shared_views where id = $1', [id]);
  return v ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const v = await load((await params).id);
  if (!v) return { title: 'View not found' };
  const title = v.camera.focus ? `A view of @${v.camera.focus}'s star` : 'A view of the Commitverse';
  return { title, openGraph: v.camera.focus ? { images: [`/api/og/${v.camera.focus}`] } : undefined, robots: { index: false } };
}

export default async function SharedView({ params }: { params: Promise<{ id: string }> }) {
  const v = await load((await params).id);
  if (!v) notFound();
  return <SceneIntent intent={{ type: 'view', camera: v.camera }} />;
}
