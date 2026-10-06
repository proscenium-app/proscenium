// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The drag payload a binder row carries: its item's id, under this type. The
 * binder sets it and a pane reads it off the same gesture to open the item
 * (src/app/PaneTree.tsx).
 */
export const BINDER_MIME = "application/x-proscenium-binder";
