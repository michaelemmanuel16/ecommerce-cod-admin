import { Response } from 'express';
import { AuthRequest } from '../types';
import { OrderStatus } from '@prisma/client';
import orderService, { BulkImportOrderData } from '../services/orderService';
import ExcelJS from 'exceljs';
import { parse } from 'csv-parse/sync';
import logger from '../utils/logger';
import fileType from 'file-type';
import { sanitizeName, sanitizePhoneNumber, sanitizeAddress, sanitizeString } from '../utils/sanitizer';
import { BULK_ORDER_CONFIG } from '../config/bulkOrderConfig';
import prisma from '../utils/prisma';
import * as Money from '../utils/money';

// Helper to find column value case-insensitively
const getColumnValue = (row: any, ...possibleNames: string[]): string => {
    for (const name of possibleNames) {
        // Try exact match first
        if (row[name] !== undefined && row[name] !== null) {
            return String(row[name]).trim();
        }
        // Try case-insensitive match
        const key = Object.keys(row).find(k => k.toLowerCase() === name.toLowerCase());
        if (key && row[key] !== undefined && row[key] !== null) {
            return String(row[key]).trim();
        }
    }
    return '';
};

// Helper to find user by full name
const findUserByName = async (fullName: string, role: 'sales_rep' | 'delivery_agent') => {
    if (!fullName) return null;

    const nameParts = fullName.trim().split(/\s+/);
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(' ');

    const users = await prisma.user.findMany({
        where: {
            role,
            isActive: true,
            OR: [
                // Try exact match on concatenated name
                {
                    AND: [
                        { firstName: { equals: firstName, mode: 'insensitive' as const } },
                        ...(lastName ? [{ lastName: { equals: lastName, mode: 'insensitive' as const } }] : [])
                    ]
                },
                // Try partial match
                {
                    OR: [
                        { firstName: { contains: fullName, mode: 'insensitive' as const } },
                        { lastName: { contains: fullName, mode: 'insensitive' as const } }
                    ]
                }
            ]
        },
        select: { id: true, firstName: true, lastName: true }
    });

    // Return best match (exact match preferred)
    const exactMatch = users.find(u =>
        `${u.firstName} ${u.lastName}`.toLowerCase() === fullName.toLowerCase()
    );

    return exactMatch || users[0] || null;
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
        const sanitizedOrders = rawData.map((row: any) => {
            const customerNameInput = getColumnValue(row, 'CUSTOMER NAME', 'Customer Name', 'name');
            const sanitizedName = sanitizeName(customerNameInput, BULK_ORDER_CONFIG.NAME.MAX_LENGTH);
            const nameParts = sanitizedName.split(' ');

            // CSV cells are text: Money.tryParse reads them exactly. A bad or empty cell counts as 0.
            const totalAmountDirect = Money.tryParse(getColumnValue(row, 'TOTAL AMOUNT', 'Total Amount', 'total')) ?? Money.ZERO;
            const price = Money.tryParse(getColumnValue(row, 'PRICE', 'Price', 'UNIT PRICE', 'Unit Price')) ?? Money.ZERO;
            const quantity = Number(getColumnValue(row, 'QUANTITY', 'Quantity', 'qty')) || 1;
            // Prefer the explicit Total Amount column; fall back to price × qty
            const totalAmount = !totalAmountDirect.isZero() ? totalAmountDirect : Money.roundHalfUp(Money.mul(price, quantity), 4);
            const unitPrice = !price.isZero()
                ? price
                : (quantity > 0 ? Money.roundHalfUp(Money.div(totalAmount, quantity), 4) : totalAmount);

            // Validate status
            let status: OrderStatus | undefined;
            const rawStatus = getColumnValue(row, 'ORDER STATUS', 'Status', 'status').toLowerCase().replace(/ /g, '_');
            if (Object.values(OrderStatus).includes(rawStatus as OrderStatus)) {
                status = rawStatus as OrderStatus;
            }

            // Extract user assignments
            const assignedRepName = getColumnValue(row, 'Assigned Rep', 'ASSIGNED REP', 'Customer Rep');
            const assignedAgentName = getColumnValue(row, 'Assigned Agent', 'ASSIGNED AGENT', 'Delivery Agent');

            // Parse date from CSV (format: dd/mm/yyyy)
            let orderDate: Date | undefined;
            const dateStr = getColumnValue(row, 'DATE [dd/mm/yyyy]', 'DATE', 'Date', 'date');
            if (dateStr) {
                const dateParts = dateStr.split('/');
                if (dateParts.length === 3) {
                    const day = parseInt(dateParts[0]);
                    const month = parseInt(dateParts[1]) - 1; // JS months are 0-indexed
                    const year = parseInt(dateParts[2]);
                    if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
                        orderDate = new Date(year, month, day);
                        // Validate the date is reasonable
                        if (orderDate.getTime() > Date.now() || orderDate.getFullYear() < 2020) {
                            orderDate = undefined; // Invalid date, will use current time
                        }
                    }
                }
            }

            return {
                customerPhone: sanitizePhoneNumber(getColumnValue(row, 'PHONE NUMBER', 'Phone', 'phone')),
                customerFirstName: nameParts[0] || 'Unknown',
                customerLastName: nameParts.slice(1).join(' ') || '',
                customerAlternatePhone: sanitizePhoneNumber(getColumnValue(row, 'ALTERNATIVE PHONE NUMBER', 'Alt Phone', 'Alternate Phone')),
                subtotal: totalAmount,
                totalAmount: totalAmount,
                deliveryAddress: sanitizeAddress(getColumnValue(row, 'CUSTOMER ADDRESS', 'Address', 'address'), BULK_ORDER_CONFIG.ADDRESS.MAX_LENGTH),
                deliveryState: sanitizeString(getColumnValue(row, 'REGION', 'Region', 'State', 'state'), BULK_ORDER_CONFIG.NAME.MAX_LENGTH),
                deliveryArea: sanitizeString(getColumnValue(row, 'REGION', 'Region', 'Area', 'area'), BULK_ORDER_CONFIG.NAME.MAX_LENGTH),
                productName: sanitizeString(getColumnValue(row, 'PRODUCT NAME', 'Product', 'product'), BULK_ORDER_CONFIG.NAME.MAX_LENGTH),
                quantity: quantity,
                unitPrice: unitPrice,
                status: status,
                notes: sanitizeString(getColumnValue(row, 'Notes', 'NOTES', 'notes'), BULK_ORDER_CONFIG.NOTES.MAX_LENGTH),
                assignedRepName,
                assignedAgentName,
                orderDate
            };
        });

        // Validate assigned users before processing
        const repNames = new Set(sanitizedOrders.map(o => o.assignedRepName).filter(Boolean));
        const agentNames = new Set(sanitizedOrders.map(o => o.assignedAgentName).filter(Boolean));

        const invalidReps: string[] = [];
        const invalidAgents: string[] = [];
        const repMap = new Map<string, number>();
        const agentMap = new Map<string, number>();

        // Validate all reps exist
        for (const repName of repNames) {
            const user = await findUserByName(repName, 'sales_rep');
            if (!user) {
                invalidReps.push(repName);
            } else {
                repMap.set(repName, user.id);
            }
        }

        // Validate all agents exist
        for (const agentName of agentNames) {
            const user = await findUserByName(agentName, 'delivery_agent');
            if (!user) {
                invalidAgents.push(agentName);
            } else {
                agentMap.set(agentName, user.id);
            }
        }

        // Return error if any users don't exist
        if (invalidReps.length > 0 || invalidAgents.length > 0) {
            const errors = [];
            if (invalidReps.length > 0) {
                errors.push(`Assigned Rep(s) not found: ${invalidReps.join(', ')}`);
            }
            if (invalidAgents.length > 0) {
                errors.push(`Assigned Agent(s) not found: ${invalidAgents.join(', ')}`);
            }
            res.status(400).json({
                message: 'User validation failed',
                errors
            });
            return;
        }


        const validOrders = sanitizedOrders.filter((order: BulkImportOrderData) => {
            // Basic presence check
            const orderAmount = Money.tryParse(order.totalAmount);
            if (!order.customerPhone || !Money.isNonZero(orderAmount) || !order.deliveryAddress) {
                logger.warn('Order filtered: missing required fields', {
                    hasPhone: !!order.customerPhone,
                    hasAmount: Money.isNonZero(orderAmount),
                    hasAddress: !!order.deliveryAddress,
                    order
                });
                return false;
            }

            // 1. Phone validation: Must have 10-15 digits
            const digitsOnly = order.customerPhone.replace(/\D/g, '');
            if (digitsOnly.length < BULK_ORDER_CONFIG.PHONE_NUMBER.DIGITS_MIN ||
                digitsOnly.length > BULK_ORDER_CONFIG.PHONE_NUMBER.DIGITS_MAX) {
                logger.warn('Order filtered: invalid phone number', {
                    phone: order.customerPhone,
                    digitsCount: digitsOnly.length,
                    order
                });
                return false;
            }

            // 2. Address validation: Minimum length after sanitization
            if (order.deliveryAddress.length < BULK_ORDER_CONFIG.ADDRESS.MIN_LENGTH) {
                logger.warn('Order filtered: address too short', {
                    address: order.deliveryAddress,
                    length: order.deliveryAddress.length,
                    minRequired: BULK_ORDER_CONFIG.ADDRESS.MIN_LENGTH,
                    order
                });
                return false;
            }

            // 3. Amount validation (already in schema but good to catch early)
            if (!Money.gt(Money.orZero(orderAmount), 0)) {
                logger.warn('Order filtered: invalid amount', {
                    amount: order.totalAmount,
                    order
                });
                return false;
            }

            return true;
        });

        logger.info('Order validation summary', {
            totalParsed: sanitizedOrders.length,
            validOrders: validOrders.length,
            filteredOut: sanitizedOrders.length - validOrders.length
        });

        if (validOrders.length === 0) {
            logger.error('No valid orders found in file', {
                totalRows: rawData.length,
                sanitizedRows: sanitizedOrders.length,
                sampleRow: sanitizedOrders[0]
            });
            res.status(400).json({ message: 'No valid orders found in file' });
            return;
        }

        const results = await orderService.bulkImportOrders(
            validOrders,
            req.user?.id,
            repMap,
            agentMap,
            validOrders.length > 10, // Enable silent mode for imports > 10 orders to prevent event storms
            // Workflows (and the messages they send) run for the import only when the uploader asks
            { runWorkflows: req.body?.runWorkflows === 'true' }
        );


        // Return results
        res.json({ results });
    } catch (error: any) {
        logger.error('Upload orders failed', { error: error.message });
        res.status(500).json({ message: 'Upload failed', error: error.message });
    }
};
