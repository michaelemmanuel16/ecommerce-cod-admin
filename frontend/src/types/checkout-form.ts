export type FieldType = 'text' | 'phone' | 'textarea' | 'select';

export interface FormField {
  id: string; // UI-only ID, not from database
  label: string;
  type: FieldType;
  required: boolean;
  enabled: boolean;
  options?: string[]; // For select type
}

export interface ProductPackage {
  id: number; // Database ID
  name: string;
  price: number;
  quantity: number;
  discountType?: 'none' | 'percentage' | 'fixed';
  discountValue?: number;
  originalPrice?: number;
  productPrice?: number; // Base product price for auto-calculating originalPrice
  isPopular: boolean; // Changed from 'popular' to match database schema
  isDefault?: boolean;
  showHighlight?: boolean; // Enable/disable highlight badge
  highlightText?: string; // Custom highlight badge text
  showDiscount?: boolean; // Show/hide discount on public checkout
}

export interface Upsell {
  id: number; // Database ID
  productId?: number;
  name: string;
  description?: string;
  imageUrl?: string;
  price: number;
  discountType?: 'none' | 'percentage' | 'fixed';
  discountValue?: number;
  originalPrice?: number;
  quantity: number; // UI field for convenience
  items?: { quantity: number }; // Database schema uses items JSON
  isPopular: boolean; // Changed from 'popular' to match database schema
}

export interface CheckoutFormSettings {
  defaultCountry: string;
}

export interface CheckoutFormStyling {
  buttonColor: string;
  accentColor: string;
}

export interface CheckoutForm {
  id: number; // Database ID (changed from CUID string to Int)
  name: string; // Changed from 'productName' to match database schema
  slug: string; // Added to match database schema
  productId: number; // Database ID (changed from CUID string to Int)
  product?: { name: string }; // Related product info from backend
  description: string;
  fields: FormField[];
  packages: ProductPackage[];
  upsells: Upsell[];
  country: string; // Changed from 'settings.defaultCountry'
  currency: string; // Currency code (e.g., GHS, NGN)
  regions: string[]; // Added from database schema
  styling: CheckoutFormStyling;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
