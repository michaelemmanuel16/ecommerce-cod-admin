# Bulk Order Management

## Overview
The bulk order management feature allows administrators to import and export orders in bulk using CSV or Excel files. This significantly speeds up order processing for businesses that receive orders through multiple channels.

## Features

### Bulk Import
- **Supported Formats**: CSV, XLSX, XLS
- **Template Download**: Available in the UI for easy formatting
- **Automatic Validation**: All imported data is validated before processing
- **Duplicate Detection**: Prevents duplicate orders within a 24-hour window
- **Product Matching**: Automatically matches products by name or SKU

### Bulk Export
- **Format Options**: CSV or XLSX
- **Filter Support**: Export respects all active filters (status, area, date range, search)
- **Template Compliance**: Exported files use the same format as the import template
- **Record Limit**: Limited to 500 records per export for memory safety and performance

## Import Template Structure

The following columns are supported for bulk import:

| Column Header | Required | Description | Example |
|--------------|----------|-------------|---------|
| `DATE [dd/mm/yyyy]` | Optional | Order date | `08/01/2026` |
| `CUSTOMER NAME` | Yes | Full name of customer | `John Doe` |
| `PHONE NUMBER` | Yes | Primary contact number | `+233123456789` |
| `ALTERNATIVE PHONE NUMBER` | Optional | Secondary contact | `+233987654321` |
| `CUSTOMER ADDRESS` | Yes | Delivery address | `123 Main St, Accra` |
| `REGION` | Yes | Delivery area/state | `Greater Accra` |
| `PRODUCT NAME` | Optional | Product to order | `Premium Package` |
| `QUANTITY` | Optional | Number of items | `2` |
| `PRICE` | Yes | Unit price | `250` |
| `ORDER STATUS` | Optional | Initial status | `pending_confirmation` |
| `Assigned Rep` | Optional | Customer rep name | `Jane Smith` |

## Important Limitations

### Multi-Product Orders ⚠️

**IMPORTANT**: The bulk import/export system currently supports **single-product orders only**.

- **Export Behavior**: If an order contains multiple products, only the **first product** will be exported
- **Import Behavior**: Each CSV row creates an order with **one product**
- **Workaround**: For multi-product orders, create separate rows in the CSV (one row per product-customer combination)

**Example**:
```csv
CUSTOMER NAME,PHONE NUMBER,ADDRESS,REGION,PRODUCT NAME,QUANTITY,PRICE
John Doe,+233123456789,123 Main St,Accra,Product A,2,100
John Doe,+233123456789,123 Main St,Accra,Product B,1,150
```

This will create **two separate orders** for John Doe, not one order with two products.

## Duplicate Detection

The system prevents duplicate orders using the following criteria:
- Same customer (phone number)
- Same total amount
- Same delivery address
- Same delivery area
- Same product (if specified)
- Within the last 24 hours

If all criteria match, the order is **skipped** and counted as a duplicate.

## Rate Limiting

To prevent abuse and resource exhaustion:

- **Export**: 5 requests per 5 minutes per IP address
- **Import**: 3 requests per 10 minutes per IP address

If you exceed these limits, you'll receive a `429 Too Many Requests` error.

## Security Features

1. **File Validation**: Both extension and MIME type are validated
2. **Input Validation**: All data is validated using Zod schemas before processing
3. **Input Sanitization**: All user inputs are sanitized to prevent XSS and injection attacks
4. **Transaction Safety**: Each order is processed in its own transaction for partial success - if one order fails, successfully imported orders are retained
5. **Audit Logging**: All bulk operations are logged for security auditing

## Error Handling

The import process provides detailed feedback:
- **Success Count**: Number of orders successfully created
- **Failed Count**: Number of orders that failed validation/creation
- **Duplicate Count**: Number of orders skipped due to duplicate detection
- **Validation Errors**: Detailed error messages for the first 10 invalid rows

## Best Practices

1. **Download Template**: Always start with the template from the UI to ensure correct formatting
2. **Test with Small Batches**: Test your CSV with 5-10 rows before importing hundreds
3. **Check for Duplicates**: Review the duplicate count after import - it may indicate data quality issues
4. **Verify Products**: Ensure product names in your CSV exactly match (or closely match) existing products in the system
5. **Stay Within Limits**: Keep exports under 1,000 records and respect rate limits

## API Endpoints

### Export Orders
```
GET /api/orders/export?format=csv&status=pending_confirmation
```

**Query Parameters**:
- `format`: `csv` or `xlsx` (default: `csv`)
- `status`: Filter by order status
- `area`: Filter by delivery area
- `startDate`, `endDate`: Filter by date range
- `search`: Text search across orders

### Import Orders
```
POST /api/orders/upload
Content-Type: multipart/form-data

file: <your-file.csv>
```

## Troubleshooting

### "No valid orders found in file"
- Check that your CSV has the correct headers
- Ensure phone numbers and prices are provided
- Verify the file is not empty

### "Duplicate orders were skipped"
- This is normal if you're re-importing the same data
- Check if orders already exist in the system within the last 24 hours

### "Rate limit exceeded"
- Wait the specified time before retrying
- For large imports, consider breaking them into smaller batches over time

### "Invalid Excel file format detected"
- Ensure the file is a genuine Excel file (not a renamed .txt file)
- Try exporting from Excel again or use CSV format instead
