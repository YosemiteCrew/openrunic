/**
 * The admin area's composed components.
 *
 * Three of these (Drawer, Tabs, and the typed-confirmation grade of
 * ConfirmDialog) are proposed additions to `@openrunic/ui`: the library has no
 * drawer, no tabs and no confirmation wrapper today, and the admin area needs
 * all three on more than one screen. They are composed from library primitives
 * here rather than forked from them, so moving them up is a file move.
 */
export { ADMIN_AREAS, adminArea, adminBreadcrumb } from './areas';
export type { AdminArea, AdminAreaId } from './areas';
export { ConfirmDialog } from './ConfirmDialog';
export type { ConfirmDialogProps } from './ConfirmDialog';
export { keywordsFrom, pluralKey, translateColumns } from './copy';
export type { AdminColumn, PluralKeys } from './copy';
export { DetailList } from './DetailList';
export type { DetailItem, DetailListProps } from './DetailList';
export { Drawer } from './Drawer';
export type { DrawerProps } from './Drawer';
export { FilterBar } from './FilterBar';
export type { FilterBarProps } from './FilterBar';
export { isAllowed, permissionKey, summariseRole } from './permissions';
export { PermissionMatrix } from './PermissionMatrix';
export type { PermissionMatrixProps } from './PermissionMatrix';
export { Tabs, TabPanel } from './Tabs';
export type { TabItem, TabPanelProps, TabsProps } from './Tabs';
