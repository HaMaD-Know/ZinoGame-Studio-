import {
  Box,
  Camera,
  Circle,
  Cone,
  Cylinder,
  Flashlight,
  Globe,
  Lightbulb,
  MapPin,
  Mountain,
  Package,
  SquareDashed,
  Sun,
  Square,
  type LucideIcon,
} from 'lucide-react';
import type { ObjectType } from '../engine/scene/types';

export const OBJECT_ICONS: Record<ObjectType, LucideIcon> = {
  empty: SquareDashed,
  cube: Box,
  sphere: Circle,
  plane: Square,
  cylinder: Cylinder,
  cone: Cone,
  directionalLight: Sun,
  pointLight: Lightbulb,
  spotLight: Flashlight,
  camera: Camera,
  baseplate: Mountain,
  spawnPoint: MapPin,
  model: Package,
};

export const EnvironmentIcon = Globe;

export function ObjectIcon({ type, size = 18 }: { type: ObjectType; size?: number }) {
  const Icon = OBJECT_ICONS[type];
  return <Icon size={size} aria-hidden="true" />;
}
