import { Response } from 'express';
import { AuthRequest } from '../types';
import { OrderStatus } from '@prisma/client';
import orderService from '../services/orderService';
import { Parser } from 'json2csv';
import ExcelJS from 'exceljs';
import { parse } from 'csv-parse/sync';
import logger from '../utils/logger';
import { exportQuerySchema } from '../utils/bulkOrderValidators';
import { z } from 'zod';
import fileType from 'file-type';
import { sanitizeName, sanitizePhoneNumber, sanitizeAddress, sanitizeString } from '../utils/sanitizer';
import { BULK_ORDER_CONFIG } from '../config/bulkOrderConfig';

export const exportOrders = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        // Validate query parameters
        const validatedQuery = exportQuerySchema.parse(req.query);

        const {
            status,
            customerId,
            customerRepId,
            deliveryAgentId,
            area,
            startDate,
            endDate,
            search,
            format
        } = validatedQuery;

        // Parse status - can be a single value or array
        let parsedStatus: OrderStatus[] | undefined;
        if (status) {
            parsedStatus = Array.isArray(status) ? status : [status];
        }

        // Role-based filtering (logic duplicated from orderController for consistency)
        let effectiveCustomerRepId = customerRepId ? Number(customerRepId) : undefined;
        if (req.user?.role === 'sales_rep') {
            effectiveCustomerRepId = req.user.id;
        }

        let effectiveDeliveryAgentId = deliveryAgentId ? Number(deliveryAgentId) : undefined;
        if (req.user?.role === 'delivery_agent') {
            effectiveDeliveryAgentId = req.user.id;
        }

        // Fetch orders without pagination for export (configurable limit to prevent memory exhaustion)
        const result = await orderService.getAllOrders({
            status: parsedStatus,
            customerId,
            customerRepId: effectiveCustomerRepId,
            deliveryAgentId: effectiveDeliveryAgentId,
            area,
            startDate: startDate ? new Date(startDate) : undefined,
            endDate: endDate ? new Date(endDate) : undefined,
            search,
            page: 1,
            limit: BULK_ORDER_CONFIG.EXPORT_MAX_RECORDS
        });

        // Log warning if limit was reached
        if (result.orders.length === BULK_ORDER_CONFIG.EXPORT_MAX_RECORDS && result.pagination.total > BULK_ORDER_CONFIG.EXPORT_MAX_RECORDS) {
            logger.warn('Export limit reached', {
                total: result.pagination.total,
                exported: BULK_ORDER_CONFIG.EXPORT_MAX_RECORDS,
                userId: req.user?.id
            });
        }

        const orders = result.orders.map(order => {
            // Format date as dd/mm/yyyy to match template
            const date = new Date(order.createdAt);
            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = date.getFullYear();
            const formattedDate = `${day}/${month}/${year}`;

            return {
                'Date': formattedDate,
                'Customer Name': `${order.customer?.firstName || ''} ${order.customer?.lastName || ''}`.trim(),
                'Phone': order.customer?.phoneNumber || '',
                'Alternative Phone': order.customer?.alternatePhone || '',
                'Address': order.deliveryAddress,
                'Area': order.deliveryArea,
                'State': order.deliveryState,
                'Product Name': order.orderItems?.[0]?.product?.name || '',
                'Quantity': order.orderItems?.[0]?.quantity || 0,
                'Total Amount': order.totalAmount,
                'Status': order.status,
                'Customer Rep': order.customerRep ? `${order.customerRep.firstName} ${order.customerRep.lastName}` : 'Unassigned',
                'Delivery Agent': order.deliveryAgent ? `${order.deliveryAgent.firstName} ${order.deliveryAgent.lastName}` : 'Unassigned',
                'Order ID': order.id,
                'Notes': order.notes || ''
            };
        });

        if (format === 'xlsx') {
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Orders');

            // Add headers
            worksheet.columns = Object.keys(orders[0] || {}).map(key => ({
                header: key,
                key: key,
                width: 20
            }));

            // Add rows
            worksheet.addRows(orders);

            const buffer = await workbook.xlsx.writeBuffer();

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename=orders_export_${Date.now()}.xlsx`);
            res.send(buffer);
        } else {
            const json2csvParser = new Parser();
            const csv = json2csvParser.parse(orders);

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=orders_export_${Date.now()}.csv`);
            res.send(csv);
        }
    } catch (error: any) {
        logger.error('Export orders failed', { error: error.message, stack: error.stack });
        if (error instanceof z.ZodError) {
            res.status(400).json({ message: 'Invalid query parameters', errors: error.issues });
            return;
        }
        res.status(500).json({ message: 'Export failed', error: error.message });
    }
};

export const uploadOrders = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        if (!req.file) {
            res.status(400).json({ message: 'No file uploaded' });
            return;
        }

        // Validate file size
        if (req.file.size > BULK_ORDER_CONFIG.MAX_FILE_SIZE) {
            res.status(400).json({
                message: `File too large. Maximum size allowed is ${BULK_ORDER_CONFIG.MAX_FILE_SIZE / (1024 * 1024)}MB`
            });
            return;
        }

        const extension = req.file.originalname.split('.').pop()?.toLowerCase();

        // Validate MIME type for Excel files (buffer is now available)
        if (extension === 'xlsx' || extension === 'xls') {
            try {
                const detectedType = await fileType.fromBuffer(req.file.buffer);
                const validMimeTypes = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'];

                if (!detectedType || !validMimeTypes.includes(detectedType.mime)) {
                    res.status(400).json({ message: 'Invalid Excel file format detected. File may be corrupted or renamed.' });
                    return;
                }
            } catch (error) {
                logger.warn('File type validation failed', { error });
                // Continue - rely on extension validation
            }
        }

        let rawData: any[] = [];

        if (extension === 'csv') {
            rawData = parse(req.file.buffer, {
                columns: true,
                skip_empty_lines: true,
                trim: true
            });
        } else if (extension === 'xlsx' || extension === 'xls') {
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.load(req.file.buffer as any);
            const worksheet = workbook.worksheets[0];

            const headers: string[] = [];
            worksheet.getRow(1).eachCell((cell) => {
                headers.push(cell.value?.toString() || '');
            });

            rawData = [];
            worksheet.eachRow((row, rowNumber) => {
                if (rowNumber === 1) return; // Skip header row
                const rowData: any = {};
                row.eachCell((cell, colNumber) => {
                    rowData[headers[colNumber - 1]] = cell.value;
                });
                rawData.push(rowData);
            });
        } else {
            res.status(400).json({ message: 'Unsupported file format' });
            return;
        }

        // Map raw data to BulkImportOrderData interface with input sanitization
        const mappedOrders = rawData.map(row => {
            const customerNameInput = String(row['CUSTOMER NAME'] || row['Customer Name'] || row['name'] || '').trim();
            const sanitizedName = sanitizeName(customerNameInput, BULK_ORDER_CONFIG.NAME.MAX_LENGTH);
            const nameParts = sanitizedName.split(' ');

            const price = Number(row['PRICE'] || row['Price'] || row['Total Amount'] || row['total'] || 0);
            const quantity = Number(row['QUANTITY'] || row['Quantity'] || 1);
            const totalAmount = price * quantity;

            // Validate status
            let status: OrderStatus | undefined;
            const rawStatus = String(row['ORDER STATUS'] || row['Status'] || '').toLowerCase().replace(/ /g, '_');
            if (Object.values(OrderStatus).includes(rawStatus as OrderStatus)) {
                status = rawStatus as OrderStatus;
            }

            return {
                customerPhone: sanitizePhoneNumber(String(row['PHONE NUMBER'] || row['Phone'] || row['phone'] || '')),
                customerFirstName: nameParts[0] || 'Unknown',
                customerLastName: nameParts.slice(1).join(' ') || '',
                customerAlternatePhone: sanitizePhoneNumber(String(row['ALTERNATIVE PHONE NUMBER'] || row['Alt Phone'] || '')),
                subtotal: totalAmount,
                totalAmount: totalAmount,
                deliveryAddress: sanitizeAddress(String(row['CUSTOMER ADDRESS'] || row['Address'] || ''), BULK_ORDER_CONFIG.ADDRESS.MAX_LENGTH),
                deliveryState: sanitizeString(String(row['REGION'] || row['Region'] || row['State'] || ''), BULK_ORDER_CONFIG.NAME.MAX_LENGTH),
                deliveryArea: sanitizeString(String(row['REGION'] || row['Region'] || row['Area'] || ''), BULK_ORDER_CONFIG.NAME.MAX_LENGTH),
                productName: sanitizeString(String(row['PRODUCT NAME'] || row['Product'] || ''), BULK_ORDER_CONFIG.NAME.MAX_LENGTH),
                quantity: quantity,
                unitPrice: price,
                status: status,
                notes: sanitizeString(String(row['Notes'] || ''), BULK_ORDER_CONFIG.NOTES.MAX_LENGTH)
            };
        }).filter(o => o.customerPhone && o.totalAmount > 0);

        if (mappedOrders.length === 0) {
            res.status(400).json({ message: 'No valid orders found in file' });
            return;
        }

        const results = await orderService.bulkImportOrders(mappedOrders, req.user?.id);

        // Return results
        res.json({ results });
    } catch (error: any) {
        logger.error('Upload orders failed', { error: error.message });
        res.status(500).json({ message: 'Upload failed', error: error.message });
    }
};
