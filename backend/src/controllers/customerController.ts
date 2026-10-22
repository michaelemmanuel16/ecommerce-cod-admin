import { Response } from 'express';
import { AuthRequest } from '../types';
import customerService, { CustomerRisk, CustomerSegment, CustomerSortField } from '../services/customerService';
import { assertWithinCap, BatchRow, ExportColumn, exportDate, exportMoney, exportPhone, readFormat, streamExport } from '../services/exportStream';

/** The filters shared by the list, the tiles and the export (F-350 to F-353). Validated by `customerListValidation`. */
function readFilters(req: AuthRequest) {
  const { search, area, region, risk, blocked, flagged, segment } = req.query;
  return {
    search: search as string | undefined,
    area: area as string | undefined,
    region: region as string | undefined,
    risk: risk as CustomerRisk | undefined,
    blocked: blocked === undefined ? undefined : blocked === 'true',
    flagged: flagged === 'true' ? true : undefined,
    segment: segment as CustomerSegment | undefined,
  };
}

export const getAllCustomers = async (req: AuthRequest, res: Response): Promise<void> => {
  const { page = 1, limit = 25, sortBy, sortOrder } = req.query;
  const result = await customerService.getAllCustomers({
    ...readFilters(req),
    page: Number(page),
    limit: Number(limit),
    sortBy: sortBy as CustomerSortField | undefined,
    sortOrder: sortOrder as 'asc' | 'desc' | undefined,
  }, req.user);

  res.json(result);
};

export const getCustomerSummary = async (req: AuthRequest, res: Response): Promise<void> => {
  res.json(await customerService.getSummary(readFilters(req), req.user));
};

export const createCustomer = async (req: AuthRequest, res: Response): Promise<void> => {
  const customer = await customerService.createCustomer(req.body, req.user);
  res.status(201).json({ customer });
};

export const getCustomer = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const customer = await customerService.getCustomerById(id, req.user);
    res.json({ customer });
  } catch (error) {
    throw error;
  }
};

export const updateCustomer = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const customer = await customerService.updateCustomer(id, updateData, req.user);
    res.json({ customer });
  } catch (error) {
    throw error;
  }
};

export const deleteCustomer = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const result = await customerService.deleteCustomer(id, req.user);
    res.json(result);
  } catch (error) {
    throw error;
  }
};

type ExportCustomer = BatchRow<ReturnType<typeof customerService.exportBatches>>;
const yesNo = (flag: boolean) => (flag ? 'Yes' : 'No');

/** F-361 columns. Risk and blocked arrive with the refusal rule (M7); they are not stored yet. */
const CUSTOMER_EXPORT_COLUMNS: ExportColumn<ExportCustomer>[] = [
  { header: 'Name', value: (c) => `${c.firstName} ${c.lastName}`.trim() },
  { header: 'Phone', value: (c) => exportPhone(c.phoneNumber), kind: 'phone' },
  { header: 'Alternate phone', value: (c) => exportPhone(c.alternatePhone), kind: 'phone' },
  { header: 'Email', value: (c) => c.email },
  { header: 'Region', value: (c) => c.state },
  { header: 'Town', value: (c) => c.area },
  { header: 'Orders', value: (c) => c.totalOrders, kind: 'count' },
  { header: 'Delivered', value: (c) => c.deliveredOrders, kind: 'count' },
  { header: 'Refused', value: (c) => c.refusedOrders, kind: 'count' },
  { header: 'Delivered value', value: (c) => exportMoney(c.deliveredValue), kind: 'money' },
  { header: 'Last order', value: (c) => exportDate(c.lastOrderAt) },
  { header: 'SMS opt-out', value: (c) => yesNo(c.smsOptOut) },
  { header: 'WhatsApp opt-out', value: (c) => yesNo(c.whatsappOptOut) },
  { header: 'Email opt-out', value: (c) => yesNo(c.emailOptOut) },
];

/** F-361: the list filters, streamed as CSV or XLSX. */
export const exportCustomers = async (req: AuthRequest, res: Response): Promise<void> => {
  const format = readFormat(req.query.format);
  const filters = readFilters(req);
  assertWithinCap(await customerService.exportCount(filters, req.user));
  await streamExport(res, {
    format,
    filename: `customers-${new Date().toISOString().slice(0, 10)}`,
    columns: CUSTOMER_EXPORT_COLUMNS,
    batches: customerService.exportBatches(filters, req.user),
  });
};
