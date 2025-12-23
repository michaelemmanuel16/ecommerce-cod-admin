# Shadcn UI Components Reference

## About Shadcn UI

Shadcn UI is a collection of re-usable components built with Radix UI and Tailwind CSS. Unlike traditional component libraries, Shadcn components are copied directly into your project, giving you full control over the code.

**Key characteristics:**
- Not a package dependency (code is copied to your project)
- Built on Radix UI primitives (accessible by default)
- Styled with Tailwind CSS
- Fully customizable
- TypeScript support

## Discovering Available Components

### Using the Shadcn Expert Agent

When working on this project, use the `shadcn-expert` agent to:
- Search for available components
- View component examples
- Get installation commands
- See usage patterns

**Example workflow:**
1. Ask shadcn-expert to search for components: "Search for button components"
2. Review available options and examples
3. Get installation command for desired components
4. Implement component following examples

### Project Registry

This project uses Shadcn UI components. To discover what's available:

**Search components:**
- Use MCP tools to search the registry
- View component source code
- Check examples and demos

**Common components likely available:**
- Button, Input, Select, Checkbox, Radio
- Card, Dialog, Dropdown Menu, Popover, Tooltip
- Form, Table, Tabs, Accordion
- Alert, Toast, Badge, Avatar
- Calendar, Date Picker, Command

## Component Categories

### Form Components

**Button**
- Variants: default, destructive, outline, secondary, ghost, link
- Sizes: sm, md (default), lg
- Usage: Primary actions, form submissions, navigation

**Input**
- Text, email, password, number, search, tel, url
- Supports: placeholder, disabled, error states
- Usage: Single-line text entry

**Textarea**
- Multi-line text input
- Auto-resize options
- Usage: Comments, descriptions, long-form content

**Select**
- Dropdown selection
- Single or multi-select
- Usage: Choosing from predefined options

**Checkbox**
- Boolean selection
- Indeterminate state support
- Usage: Multiple selections, toggles

**Radio Group**
- Mutually exclusive selection
- Grouped options
- Usage: Single choice from options

**Switch**
- Toggle between two states
- Usage: Settings, feature toggles

**Form**
- Built with React Hook Form + Zod
- Automatic validation
- Error handling
- Usage: Wrapping form inputs with validation

### Display Components

**Card**
- Container for content
- Variants: default, outline
- Parts: CardHeader, CardTitle, CardDescription, CardContent, CardFooter
- Usage: Grouping related information

**Badge**
- Small label or status indicator
- Variants: default, secondary, destructive, outline
- Usage: Tags, status labels, counts

**Avatar**
- User profile images
- Fallback to initials
- Sizes: sm, md, lg
- Usage: User identification

**Separator**
- Horizontal or vertical divider
- Usage: Separating content sections

**Skeleton**
- Loading placeholder
- Usage: Content loading states

### Overlay Components

**Dialog (Modal)**
- Modal overlay
- Parts: DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
- Usage: Forms, confirmations, additional information

**Sheet**
- Slide-out panel
- Positions: top, right, bottom, left
- Usage: Side navigation, filters, details panel

**Popover**
- Floating content container
- Usage: Additional info, small forms, pickers

**Tooltip**
- Brief supplementary information
- Positions: top, right, bottom, left
- Usage: Icon labels, help text

**Dropdown Menu**
- Menu with actions
- Parts: DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator
- Usage: Context menus, action menus

**Command**
- Command palette / search
- Keyboard navigation
- Usage: Quick actions, search functionality

### Navigation Components

**Tabs**
- Switch between views
- Parts: TabsList, TabsTrigger, TabsContent
- Usage: Switching content without navigation

**Accordion**
- Collapsible content sections
- Single or multiple open
- Usage: FAQ, grouped content

**Breadcrumb**
- Navigation hierarchy
- Usage: Showing current location

### Data Components

**Table**
- Data grid
- Sortable columns
- Usage: Displaying tabular data

**Data Table**
- Enhanced table with sorting, filtering, pagination
- Built with TanStack Table
- Usage: Complex data grids

### Feedback Components

**Alert**
- Important messages
- Variants: default, destructive
- Usage: Warnings, errors, info messages

**Toast**
- Temporary notification
- Auto-dismiss
- Usage: Action feedback, notifications

**Progress**
- Progress indicator
- Usage: Loading states, completion status

### Date & Time Components

**Calendar**
- Date picker
- Single or range selection
- Usage: Date selection

**Date Picker**
- Input with calendar popup
- Range picker option
- Usage: Form date inputs

## Design Patterns with Shadcn

### Form Pattern

```tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const formSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

function LoginForm() {
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const onSubmit = (values) => {
    console.log(values);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" placeholder="you@example.com" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <Input type="password" {...field} />
              </FormControl>
              <FormDescription>
                Must be at least 8 characters
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit">Log in</Button>
      </form>
    </Form>
  );
}
```

### Modal/Dialog Pattern

```tsx
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

function DeleteConfirmation({ onConfirm }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="destructive">Delete</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Are you sure?</DialogTitle>
          <DialogDescription>
            This action cannot be undone. This will permanently delete the item.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline">Cancel</Button>
          <Button variant="destructive" onClick={onConfirm}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

### Dropdown Menu Pattern

```tsx
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';

function UserMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost">Options</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>My Account</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>Profile</DropdownMenuItem>
        <DropdownMenuItem>Settings</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive">
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

### Data Table Pattern

```tsx
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

function OrdersTable({ orders }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Order ID</TableHead>
          <TableHead>Customer</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {orders.map((order) => (
          <TableRow key={order.id}>
            <TableCell>{order.id}</TableCell>
            <TableCell>{order.customer}</TableCell>
            <TableCell>
              <Badge variant={order.statusVariant}>
                {order.status}
              </Badge>
            </TableCell>
            <TableCell className="text-right">
              ${order.amount}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

## Customization

### Theming

Shadcn uses CSS variables for theming. Customize in `globals.css`:

```css
@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --primary: 222.2 47.4% 11.2%;
    --primary-foreground: 210 40% 98%;
    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    /* ... more variables */
  }

  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    /* ... dark mode variables */
  }
}
```

### Component Customization

Since components are in your project, you can:
- Modify component code directly
- Add new variants
- Change default props
- Extend functionality

**Example: Adding a new button variant**
```tsx
// In components/ui/button.tsx
const buttonVariants = cva(
  "...",
  {
    variants: {
      variant: {
        default: "...",
        destructive: "...",
        custom: "bg-purple-500 text-white hover:bg-purple-600", // New variant
      },
    },
  }
);
```

## Accessibility Features

Shadcn components are built on Radix UI, which provides:
- ✅ Keyboard navigation
- ✅ Focus management
- ✅ ARIA attributes
- ✅ Screen reader support
- ✅ Proper semantic HTML

**Still need to:**
- Provide meaningful labels
- Add alt text to images
- Ensure color contrast
- Test with keyboard and screen readers

## Best Practices

### Do's

✅ **Use semantic HTML**
```tsx
<Button asChild>
  <a href="/dashboard">Dashboard</a>
</Button>
```

✅ **Provide accessible labels**
```tsx
<Button aria-label="Close dialog">
  <X className="h-4 w-4" />
</Button>
```

✅ **Use Form component for validation**
```tsx
<Form {...form}>
  <FormField ... />
</Form>
```

✅ **Leverage variants**
```tsx
<Button variant="destructive">Delete</Button>
<Badge variant="outline">New</Badge>
```

✅ **Use asChild for composition**
```tsx
<Button asChild>
  <Link to="/profile">Profile</Link>
</Button>
```

### Don'ts

❌ **Don't remove accessibility features**
```tsx
// Bad
<Dialog modal={false}>...</Dialog>
```

❌ **Don't skip validation**
```tsx
// Bad - no validation
<Input onChange={handleChange} />

// Good - with validation
<FormField control={form.control} name="email" ... />
```

❌ **Don't nest interactive elements**
```tsx
// Bad
<Button>
  <a href="/link">Click</a>
</Button>

// Good
<Button asChild>
  <a href="/link">Click</a>
</Button>
```

❌ **Don't hardcode colors**
```tsx
// Bad
<div className="bg-blue-500">

// Good - use design tokens
<div className="bg-primary">
```

## Common Patterns in This Project

Based on the e-commerce COD admin dashboard:

**Order Status Badges**
```tsx
<Badge variant={
  status === 'delivered' ? 'default' :
  status === 'cancelled' ? 'destructive' :
  'secondary'
}>
  {status}
</Badge>
```

**Action Menus**
```tsx
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="ghost" size="icon">
      <MoreVertical className="h-4 w-4" />
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent>
    <DropdownMenuItem onClick={handleEdit}>Edit</DropdownMenuItem>
    <DropdownMenuItem onClick={handleView}>View Details</DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuItem className="text-destructive" onClick={handleDelete}>
      Delete
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

**Confirmation Dialogs**
```tsx
<AlertDialog>
  <AlertDialogTrigger asChild>
    <Button variant="destructive">Delete Order</Button>
  </AlertDialogTrigger>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Delete Order?</AlertDialogTitle>
      <AlertDialogDescription>
        This will permanently delete order #{orderId}. This action cannot be undone.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

## Resources

**Official Documentation:**
- https://ui.shadcn.com/docs
- https://ui.shadcn.com/docs/components

**Radix UI Documentation:**
- https://www.radix-ui.com/primitives/docs

**Examples:**
- Use the shadcn-expert agent to search for component examples
- Check the project's existing components for patterns
- View Shadcn docs for comprehensive examples
