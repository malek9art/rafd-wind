export interface CategoryInfo {
  id: string
  name: string
  icon: string
  byWeight?: boolean
}

export const ALL_CATEGORIES: CategoryInfo[] = [
  { id: 'general', name: 'عام', icon: '📦', byWeight: false },
  { id: 'grocery', name: 'بقالة', icon: '🛒', byWeight: false },
  { id: 'veg_fruits', name: 'خضروات وفواكه', icon: '🍎', byWeight: true },
  { id: 'meat_fish', name: 'لحوم وأسماك', icon: '🥩', byWeight: true },
  { id: 'cheese_dairy', name: 'أجبان وألبان', icon: '🧀', byWeight: true },
  { id: 'sweets', name: 'حلويات', icon: '🍬', byWeight: false },
  { id: 'beverages', name: 'مشروبات', icon: '🥤', byWeight: false }
]

export function isWeightCategory(categoryName: string): boolean {
  const cat = ALL_CATEGORIES.find(c => c.name === categoryName)
  return !!cat?.byWeight
}

export function isWeightProduct(product: { sell_by_weight?: number | boolean | null; category?: string }): boolean {
  if (product.sell_by_weight === 1 || product.sell_by_weight === true) {
    return true
  }
  if (product.category && isWeightCategory(product.category)) {
    return true
  }
  return false
}
