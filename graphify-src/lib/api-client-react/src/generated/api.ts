import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  MutationFunction,
  QueryFunction,
  QueryKey,
  UseMutationOptions,
  UseMutationResult,
  UseQueryOptions,
  UseQueryResult,
} from "@tanstack/react-query";

import type {
  AuthResult,
  BookingResponseInput,
  Cart,
  CartItemInput,
  CartItemUpdate,
  CategoryItem,
  Customer,
  DashboardStats,
  DeliveryZone,
  DeliveryZoneInput,
  DeliveryZoneUpdate,
  GalleryItem,
  GalleryItemInput,
  HealthStatus,
  ListGalleryParams,
  ListOrdersParams,
  ListProductsParams,
  ListReviewsParams,
  MessageResponse,
  Order,
  OrderInput,
  OrderStatusUpdate,
  OrderTracking,
  OtpRequest,
  OtpResponse,
  OtpVerify,
  Product,
  ProductInput,
  ProductUpdate,
  Review,
  ReviewInput,
  Service,
  ServiceOrder,
  ServiceOrderInput,
  StatusCount,
} from "./api.schemas";

import { customFetch } from "../custom-fetch";
import type { ErrorType, BodyType } from "../custom-fetch";

type AwaitedInput<T> = PromiseLike<T> | T;

type Awaited<O> = O extends AwaitedInput<infer T> ? T : never;

type SecondParameter<T extends (...args: never) => unknown> = Parameters<T>[1];

/**
 * @summary Health check
 */
export const getHealthCheckUrl = () => {
  return `/api/healthz`;
};

export const healthCheck = async (
  options?: RequestInit,
): Promise<HealthStatus> => {
  return customFetch<HealthStatus>(getHealthCheckUrl(), {
    ...options,
    method: "GET",
  });
};

export const getHealthCheckQueryKey = () => {
  return [`/api/healthz`] as const;
};

export const getHealthCheckQueryOptions = <
  TData = Awaited<ReturnType<typeof healthCheck>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof healthCheck>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getHealthCheckQueryKey();

  const queryFn: QueryFunction<Awaited<ReturnType<typeof healthCheck>>> = ({
    signal,
  }) => healthCheck({ signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof healthCheck>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type HealthCheckQueryResult = NonNullable<
  Awaited<ReturnType<typeof healthCheck>>
>;
export type HealthCheckQueryError = ErrorType<unknown>;

/**
 * @summary Health check
 */

export function useHealthCheck<
  TData = Awaited<ReturnType<typeof healthCheck>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof healthCheck>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getHealthCheckQueryOptions(options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Request OTP via WhatsApp
 */
export const getRequestOtpUrl = () => {
  return `/api/auth/request-otp`;
};

export const requestOtp = async (
  otpRequest: OtpRequest,
  options?: RequestInit,
): Promise<OtpResponse> => {
  return customFetch<OtpResponse>(getRequestOtpUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(otpRequest),
  });
};

export const getRequestOtpMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof requestOtp>>,
    TError,
    { data: BodyType<OtpRequest> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof requestOtp>>,
  TError,
  { data: BodyType<OtpRequest> },
  TContext
> => {
  const mutationKey = ["requestOtp"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof requestOtp>>,
    { data: BodyType<OtpRequest> }
  > = (props) => {
    const { data } = props ?? {};

    return requestOtp(data, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type RequestOtpMutationResult = NonNullable<
  Awaited<ReturnType<typeof requestOtp>>
>;
export type RequestOtpMutationBody = BodyType<OtpRequest>;
export type RequestOtpMutationError = ErrorType<unknown>;

/**
 * @summary Request OTP via WhatsApp
 */
export const useRequestOtp = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof requestOtp>>,
    TError,
    { data: BodyType<OtpRequest> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof requestOtp>>,
  TError,
  { data: BodyType<OtpRequest> },
  TContext
> => {
  return useMutation(getRequestOtpMutationOptions(options));
};

/**
 * @summary Verify OTP and login
 */
export const getVerifyOtpUrl = () => {
  return `/api/auth/verify-otp`;
};

export const verifyOtp = async (
  otpVerify: OtpVerify,
  options?: RequestInit,
): Promise<AuthResult> => {
  return customFetch<AuthResult>(getVerifyOtpUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(otpVerify),
  });
};

export const getVerifyOtpMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof verifyOtp>>,
    TError,
    { data: BodyType<OtpVerify> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof verifyOtp>>,
  TError,
  { data: BodyType<OtpVerify> },
  TContext
> => {
  const mutationKey = ["verifyOtp"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof verifyOtp>>,
    { data: BodyType<OtpVerify> }
  > = (props) => {
    const { data } = props ?? {};

    return verifyOtp(data, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type VerifyOtpMutationResult = NonNullable<
  Awaited<ReturnType<typeof verifyOtp>>
>;
export type VerifyOtpMutationBody = BodyType<OtpVerify>;
export type VerifyOtpMutationError = ErrorType<unknown>;

/**
 * @summary Verify OTP and login
 */
export const useVerifyOtp = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof verifyOtp>>,
    TError,
    { data: BodyType<OtpVerify> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof verifyOtp>>,
  TError,
  { data: BodyType<OtpVerify> },
  TContext
> => {
  return useMutation(getVerifyOtpMutationOptions(options));
};

/**
 * @summary Get current customer
 */
export const getGetMeUrl = () => {
  return `/api/auth/me`;
};

export const getMe = async (options?: RequestInit): Promise<Customer> => {
  return customFetch<Customer>(getGetMeUrl(), {
    ...options,
    method: "GET",
  });
};

export const getGetMeQueryKey = () => {
  return [`/api/auth/me`] as const;
};

export const getGetMeQueryOptions = <
  TData = Awaited<ReturnType<typeof getMe>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<Awaited<ReturnType<typeof getMe>>, TError, TData>;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getGetMeQueryKey();

  const queryFn: QueryFunction<Awaited<ReturnType<typeof getMe>>> = ({
    signal,
  }) => getMe({ signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof getMe>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type GetMeQueryResult = NonNullable<Awaited<ReturnType<typeof getMe>>>;
export type GetMeQueryError = ErrorType<unknown>;

/**
 * @summary Get current customer
 */

export function useGetMe<
  TData = Awaited<ReturnType<typeof getMe>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<Awaited<ReturnType<typeof getMe>>, TError, TData>;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetMeQueryOptions(options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Logout
 */
export const getLogoutUrl = () => {
  return `/api/auth/logout`;
};

export const logout = async (
  options?: RequestInit,
): Promise<MessageResponse> => {
  return customFetch<MessageResponse>(getLogoutUrl(), {
    ...options,
    method: "POST",
  });
};

export const getLogoutMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof logout>>,
    TError,
    void,
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof logout>>,
  TError,
  void,
  TContext
> => {
  const mutationKey = ["logout"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof logout>>,
    void
  > = () => {
    return logout(requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type LogoutMutationResult = NonNullable<
  Awaited<ReturnType<typeof logout>>
>;

export type LogoutMutationError = ErrorType<unknown>;

/**
 * @summary Logout
 */
export const useLogout = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof logout>>,
    TError,
    void,
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof logout>>,
  TError,
  void,
  TContext
> => {
  return useMutation(getLogoutMutationOptions(options));
};

/**
 * @summary List products
 */
export const getListProductsUrl = (params?: ListProductsParams) => {
  const normalizedParams = new URLSearchParams();

  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined) {
      normalizedParams.append(key, value === null ? "null" : value.toString());
    }
  });

  const stringifiedParams = normalizedParams.toString();

  return stringifiedParams.length > 0
    ? `/api/products?${stringifiedParams}`
    : `/api/products`;
};

export const listProducts = async (
  params?: ListProductsParams,
  options?: RequestInit,
): Promise<Product[]> => {
  return customFetch<Product[]>(getListProductsUrl(params), {
    ...options,
    method: "GET",
  });
};

export const getListProductsQueryKey = (params?: ListProductsParams) => {
  return [`/api/products`, ...(params ? [params] : [])] as const;
};

export const getListProductsQueryOptions = <
  TData = Awaited<ReturnType<typeof listProducts>>,
  TError = ErrorType<unknown>,
>(
  params?: ListProductsParams,
  options?: {
    query?: UseQueryOptions<
      Awaited<ReturnType<typeof listProducts>>,
      TError,
      TData
    >;
    request?: SecondParameter<typeof customFetch>;
  },
) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getListProductsQueryKey(params);

  const queryFn: QueryFunction<Awaited<ReturnType<typeof listProducts>>> = ({
    signal,
  }) => listProducts(params, { signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof listProducts>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type ListProductsQueryResult = NonNullable<
  Awaited<ReturnType<typeof listProducts>>
>;
export type ListProductsQueryError = ErrorType<unknown>;

/**
 * @summary List products
 */

export function useListProducts<
  TData = Awaited<ReturnType<typeof listProducts>>,
  TError = ErrorType<unknown>,
>(
  params?: ListProductsParams,
  options?: {
    query?: UseQueryOptions<
      Awaited<ReturnType<typeof listProducts>>,
      TError,
      TData
    >;
    request?: SecondParameter<typeof customFetch>;
  },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getListProductsQueryOptions(params, options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Create product (admin)
 */
export const getCreateProductUrl = () => {
  return `/api/products`;
};

export const createProduct = async (
  productInput: ProductInput,
  options?: RequestInit,
): Promise<Product> => {
  return customFetch<Product>(getCreateProductUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(productInput),
  });
};

export const getCreateProductMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof createProduct>>,
    TError,
    { data: BodyType<ProductInput> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof createProduct>>,
  TError,
  { data: BodyType<ProductInput> },
  TContext
> => {
  const mutationKey = ["createProduct"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof createProduct>>,
    { data: BodyType<ProductInput> }
  > = (props) => {
    const { data } = props ?? {};

    return createProduct(data, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type CreateProductMutationResult = NonNullable<
  Awaited<ReturnType<typeof createProduct>>
>;
export type CreateProductMutationBody = BodyType<ProductInput>;
export type CreateProductMutationError = ErrorType<unknown>;

/**
 * @summary Create product (admin)
 */
export const useCreateProduct = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof createProduct>>,
    TError,
    { data: BodyType<ProductInput> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof createProduct>>,
  TError,
  { data: BodyType<ProductInput> },
  TContext
> => {
  return useMutation(getCreateProductMutationOptions(options));
};

/**
 * @summary Get product by ID
 */
export const getGetProductUrl = (id: number) => {
  return `/api/products/${id}`;
};

export const getProduct = async (
  id: number,
  options?: RequestInit,
): Promise<Product> => {
  return customFetch<Product>(getGetProductUrl(id), {
    ...options,
    method: "GET",
  });
};

export const getGetProductQueryKey = (id: number) => {
  return [`/api/products/${id}`] as const;
};

export const getGetProductQueryOptions = <
  TData = Awaited<ReturnType<typeof getProduct>>,
  TError = ErrorType<unknown>,
>(
  id: number,
  options?: {
    query?: UseQueryOptions<
      Awaited<ReturnType<typeof getProduct>>,
      TError,
      TData
    >;
    request?: SecondParameter<typeof customFetch>;
  },
) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getGetProductQueryKey(id);

  const queryFn: QueryFunction<Awaited<ReturnType<typeof getProduct>>> = ({
    signal,
  }) => getProduct(id, { signal, ...requestOptions });

  return {
    queryKey,
    queryFn,
    enabled: !!id,
    ...queryOptions,
  } as UseQueryOptions<
    Awaited<ReturnType<typeof getProduct>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type GetProductQueryResult = NonNullable<
  Awaited<ReturnType<typeof getProduct>>
>;
export type GetProductQueryError = ErrorType<unknown>;

/**
 * @summary Get product by ID
 */

export function useGetProduct<
  TData = Awaited<ReturnType<typeof getProduct>>,
  TError = ErrorType<unknown>,
>(
  id: number,
  options?: {
    query?: UseQueryOptions<
      Awaited<ReturnType<typeof getProduct>>,
      TError,
      TData
    >;
    request?: SecondParameter<typeof customFetch>;
  },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetProductQueryOptions(id, options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Update product (admin)
 */
export const getUpdateProductUrl = (id: number) => {
  return `/api/products/${id}`;
};

export const updateProduct = async (
  id: number,
  productUpdate: ProductUpdate,
  options?: RequestInit,
): Promise<Product> => {
  return customFetch<Product>(getUpdateProductUrl(id), {
    ...options,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(productUpdate),
  });
};

export const getUpdateProductMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof updateProduct>>,
    TError,
    { id: number; data: BodyType<ProductUpdate> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof updateProduct>>,
  TError,
  { id: number; data: BodyType<ProductUpdate> },
  TContext
> => {
  const mutationKey = ["updateProduct"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof updateProduct>>,
    { id: number; data: BodyType<ProductUpdate> }
  > = (props) => {
    const { id, data } = props ?? {};

    return updateProduct(id, data, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type UpdateProductMutationResult = NonNullable<
  Awaited<ReturnType<typeof updateProduct>>
>;
export type UpdateProductMutationBody = BodyType<ProductUpdate>;
export type UpdateProductMutationError = ErrorType<unknown>;

/**
 * @summary Update product (admin)
 */
export const useUpdateProduct = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof updateProduct>>,
    TError,
    { id: number; data: BodyType<ProductUpdate> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof updateProduct>>,
  TError,
  { id: number; data: BodyType<ProductUpdate> },
  TContext
> => {
  return useMutation(getUpdateProductMutationOptions(options));
};

/**
 * @summary Delete product (admin)
 */
export const getDeleteProductUrl = (id: number) => {
  return `/api/products/${id}`;
};

export const deleteProduct = async (
  id: number,
  options?: RequestInit,
): Promise<MessageResponse> => {
  return customFetch<MessageResponse>(getDeleteProductUrl(id), {
    ...options,
    method: "DELETE",
  });
};

export const getDeleteProductMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof deleteProduct>>,
    TError,
    { id: number },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof deleteProduct>>,
  TError,
  { id: number },
  TContext
> => {
  const mutationKey = ["deleteProduct"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof deleteProduct>>,
    { id: number }
  > = (props) => {
    const { id } = props ?? {};

    return deleteProduct(id, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type DeleteProductMutationResult = NonNullable<
  Awaited<ReturnType<typeof deleteProduct>>
>;

export type DeleteProductMutationError = ErrorType<unknown>;

/**
 * @summary Delete product (admin)
 */
export const useDeleteProduct = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof deleteProduct>>,
    TError,
    { id: number },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof deleteProduct>>,
  TError,
  { id: number },
  TContext
> => {
  return useMutation(getDeleteProductMutationOptions(options));
};

/**
 * @summary Get featured/top products
 */
export const getGetFeaturedProductsUrl = () => {
  return `/api/products/featured`;
};

export const getFeaturedProducts = async (
  options?: RequestInit,
): Promise<Product[]> => {
  return customFetch<Product[]>(getGetFeaturedProductsUrl(), {
    ...options,
    method: "GET",
  });
};

export const getGetFeaturedProductsQueryKey = () => {
  return [`/api/products/featured`] as const;
};

export const getGetFeaturedProductsQueryOptions = <
  TData = Awaited<ReturnType<typeof getFeaturedProducts>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getFeaturedProducts>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getGetFeaturedProductsQueryKey();

  const queryFn: QueryFunction<
    Awaited<ReturnType<typeof getFeaturedProducts>>
  > = ({ signal }) => getFeaturedProducts({ signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof getFeaturedProducts>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type GetFeaturedProductsQueryResult = NonNullable<
  Awaited<ReturnType<typeof getFeaturedProducts>>
>;
export type GetFeaturedProductsQueryError = ErrorType<unknown>;

/**
 * @summary Get featured/top products
 */

export function useGetFeaturedProducts<
  TData = Awaited<ReturnType<typeof getFeaturedProducts>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getFeaturedProducts>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetFeaturedProductsQueryOptions(options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary List product categories
 */
export const getListProductCategoriesUrl = () => {
  return `/api/products/categories`;
};

export const listProductCategories = async (
  options?: RequestInit,
): Promise<CategoryItem[]> => {
  return customFetch<CategoryItem[]>(getListProductCategoriesUrl(), {
    ...options,
    method: "GET",
  });
};

export const getListProductCategoriesQueryKey = () => {
  return [`/api/products/categories`] as const;
};

export const getListProductCategoriesQueryOptions = <
  TData = Awaited<ReturnType<typeof listProductCategories>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof listProductCategories>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getListProductCategoriesQueryKey();

  const queryFn: QueryFunction<
    Awaited<ReturnType<typeof listProductCategories>>
  > = ({ signal }) => listProductCategories({ signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof listProductCategories>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type ListProductCategoriesQueryResult = NonNullable<
  Awaited<ReturnType<typeof listProductCategories>>
>;
export type ListProductCategoriesQueryError = ErrorType<unknown>;

/**
 * @summary List product categories
 */

export function useListProductCategories<
  TData = Awaited<ReturnType<typeof listProductCategories>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof listProductCategories>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getListProductCategoriesQueryOptions(options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary List all services
 */
export const getListServicesUrl = () => {
  return `/api/services`;
};

export const listServices = async (
  options?: RequestInit,
): Promise<Service[]> => {
  return customFetch<Service[]>(getListServicesUrl(), {
    ...options,
    method: "GET",
  });
};

export const getListServicesQueryKey = () => {
  return [`/api/services`] as const;
};

export const getListServicesQueryOptions = <
  TData = Awaited<ReturnType<typeof listServices>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof listServices>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getListServicesQueryKey();

  const queryFn: QueryFunction<Awaited<ReturnType<typeof listServices>>> = ({
    signal,
  }) => listServices({ signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof listServices>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type ListServicesQueryResult = NonNullable<
  Awaited<ReturnType<typeof listServices>>
>;
export type ListServicesQueryError = ErrorType<unknown>;

/**
 * @summary List all services
 */

export function useListServices<
  TData = Awaited<ReturnType<typeof listServices>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof listServices>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getListServicesQueryOptions(options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Get service by ID
 */
export const getGetServiceUrl = (id: number) => {
  return `/api/services/${id}`;
};

export const getService = async (
  id: number,
  options?: RequestInit,
): Promise<Service> => {
  return customFetch<Service>(getGetServiceUrl(id), {
    ...options,
    method: "GET",
  });
};

export const getGetServiceQueryKey = (id: number) => {
  return [`/api/services/${id}`] as const;
};

export const getGetServiceQueryOptions = <
  TData = Awaited<ReturnType<typeof getService>>,
  TError = ErrorType<unknown>,
>(
  id: number,
  options?: {
    query?: UseQueryOptions<
      Awaited<ReturnType<typeof getService>>,
      TError,
      TData
    >;
    request?: SecondParameter<typeof customFetch>;
  },
) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getGetServiceQueryKey(id);

  const queryFn: QueryFunction<Awaited<ReturnType<typeof getService>>> = ({
    signal,
  }) => getService(id, { signal, ...requestOptions });

  return {
    queryKey,
    queryFn,
    enabled: !!id,
    ...queryOptions,
  } as UseQueryOptions<
    Awaited<ReturnType<typeof getService>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type GetServiceQueryResult = NonNullable<
  Awaited<ReturnType<typeof getService>>
>;
export type GetServiceQueryError = ErrorType<unknown>;

/**
 * @summary Get service by ID
 */

export function useGetService<
  TData = Awaited<ReturnType<typeof getService>>,
  TError = ErrorType<unknown>,
>(
  id: number,
  options?: {
    query?: UseQueryOptions<
      Awaited<ReturnType<typeof getService>>,
      TError,
      TData
    >;
    request?: SecondParameter<typeof customFetch>;
  },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetServiceQueryOptions(id, options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Submit a service order request
 */
export const getCreateServiceOrderUrl = () => {
  return `/api/service-orders`;
};

export const createServiceOrder = async (
  serviceOrderInput: ServiceOrderInput,
  options?: RequestInit,
): Promise<ServiceOrder> => {
  return customFetch<ServiceOrder>(getCreateServiceOrderUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(serviceOrderInput),
  });
};

export const getCreateServiceOrderMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof createServiceOrder>>,
    TError,
    { data: BodyType<ServiceOrderInput> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof createServiceOrder>>,
  TError,
  { data: BodyType<ServiceOrderInput> },
  TContext
> => {
  const mutationKey = ["createServiceOrder"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof createServiceOrder>>,
    { data: BodyType<ServiceOrderInput> }
  > = (props) => {
    const { data } = props ?? {};

    return createServiceOrder(data, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type CreateServiceOrderMutationResult = NonNullable<
  Awaited<ReturnType<typeof createServiceOrder>>
>;
export type CreateServiceOrderMutationBody = BodyType<ServiceOrderInput>;
export type CreateServiceOrderMutationError = ErrorType<unknown>;

/**
 * @summary Submit a service order request
 */
export const useCreateServiceOrder = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof createServiceOrder>>,
    TError,
    { data: BodyType<ServiceOrderInput> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof createServiceOrder>>,
  TError,
  { data: BodyType<ServiceOrderInput> },
  TContext
> => {
  return useMutation(getCreateServiceOrderMutationOptions(options));
};

/**
 * @summary Customer confirms or requests a reschedule for a booking (public, gated by tracking code)
 */
export const getRespondToBookingUrl = (trackingCode: string) => {
  return `/api/service-orders/track/${trackingCode}/respond`;
};

export const respondToBooking = async (
  trackingCode: string,
  bookingResponseInput: BookingResponseInput,
  options?: RequestInit,
): Promise<OrderTracking> => {
  return customFetch<OrderTracking>(getRespondToBookingUrl(trackingCode), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(bookingResponseInput),
  });
};

export const getRespondToBookingMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof respondToBooking>>,
    TError,
    { trackingCode: string; data: BodyType<BookingResponseInput> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof respondToBooking>>,
  TError,
  { trackingCode: string; data: BodyType<BookingResponseInput> },
  TContext
> => {
  const mutationKey = ["respondToBooking"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof respondToBooking>>,
    { trackingCode: string; data: BodyType<BookingResponseInput> }
  > = (props) => {
    const { trackingCode, data } = props ?? {};

    return respondToBooking(trackingCode, data, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type RespondToBookingMutationResult = NonNullable<
  Awaited<ReturnType<typeof respondToBooking>>
>;
export type RespondToBookingMutationBody = BodyType<BookingResponseInput>;
export type RespondToBookingMutationError = ErrorType<unknown>;

/**
 * @summary Customer confirms or requests a reschedule for a booking (public, gated by tracking code)
 */
export const useRespondToBooking = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof respondToBooking>>,
    TError,
    { trackingCode: string; data: BodyType<BookingResponseInput> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof respondToBooking>>,
  TError,
  { trackingCode: string; data: BodyType<BookingResponseInput> },
  TContext
> => {
  return useMutation(getRespondToBookingMutationOptions(options));
};

/**
 * @summary Get current cart
 */
export const getGetCartUrl = () => {
  return `/api/cart`;
};

export const getCart = async (options?: RequestInit): Promise<Cart> => {
  return customFetch<Cart>(getGetCartUrl(), {
    ...options,
    method: "GET",
  });
};

export const getGetCartQueryKey = () => {
  return [`/api/cart`] as const;
};

export const getGetCartQueryOptions = <
  TData = Awaited<ReturnType<typeof getCart>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<Awaited<ReturnType<typeof getCart>>, TError, TData>;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getGetCartQueryKey();

  const queryFn: QueryFunction<Awaited<ReturnType<typeof getCart>>> = ({
    signal,
  }) => getCart({ signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof getCart>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type GetCartQueryResult = NonNullable<
  Awaited<ReturnType<typeof getCart>>
>;
export type GetCartQueryError = ErrorType<unknown>;

/**
 * @summary Get current cart
 */

export function useGetCart<
  TData = Awaited<ReturnType<typeof getCart>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<Awaited<ReturnType<typeof getCart>>, TError, TData>;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetCartQueryOptions(options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Add item to cart
 */
export const getAddToCartUrl = () => {
  return `/api/cart`;
};

export const addToCart = async (
  cartItemInput: CartItemInput,
  options?: RequestInit,
): Promise<Cart> => {
  return customFetch<Cart>(getAddToCartUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(cartItemInput),
  });
};

export const getAddToCartMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof addToCart>>,
    TError,
    { data: BodyType<CartItemInput> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof addToCart>>,
  TError,
  { data: BodyType<CartItemInput> },
  TContext
> => {
  const mutationKey = ["addToCart"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof addToCart>>,
    { data: BodyType<CartItemInput> }
  > = (props) => {
    const { data } = props ?? {};

    return addToCart(data, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type AddToCartMutationResult = NonNullable<
  Awaited<ReturnType<typeof addToCart>>
>;
export type AddToCartMutationBody = BodyType<CartItemInput>;
export type AddToCartMutationError = ErrorType<unknown>;

/**
 * @summary Add item to cart
 */
export const useAddToCart = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof addToCart>>,
    TError,
    { data: BodyType<CartItemInput> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof addToCart>>,
  TError,
  { data: BodyType<CartItemInput> },
  TContext
> => {
  return useMutation(getAddToCartMutationOptions(options));
};

/**
 * @summary Clear cart
 */
export const getClearCartUrl = () => {
  return `/api/cart`;
};

export const clearCart = async (
  options?: RequestInit,
): Promise<MessageResponse> => {
  return customFetch<MessageResponse>(getClearCartUrl(), {
    ...options,
    method: "DELETE",
  });
};

export const getClearCartMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof clearCart>>,
    TError,
    void,
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof clearCart>>,
  TError,
  void,
  TContext
> => {
  const mutationKey = ["clearCart"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof clearCart>>,
    void
  > = () => {
    return clearCart(requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type ClearCartMutationResult = NonNullable<
  Awaited<ReturnType<typeof clearCart>>
>;

export type ClearCartMutationError = ErrorType<unknown>;

/**
 * @summary Clear cart
 */
export const useClearCart = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof clearCart>>,
    TError,
    void,
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof clearCart>>,
  TError,
  void,
  TContext
> => {
  return useMutation(getClearCartMutationOptions(options));
};

/**
 * @summary Update cart item quantity
 */
export const getUpdateCartItemUrl = (itemId: number) => {
  return `/api/cart/${itemId}`;
};

export const updateCartItem = async (
  itemId: number,
  cartItemUpdate: CartItemUpdate,
  options?: RequestInit,
): Promise<Cart> => {
  return customFetch<Cart>(getUpdateCartItemUrl(itemId), {
    ...options,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(cartItemUpdate),
  });
};

export const getUpdateCartItemMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof updateCartItem>>,
    TError,
    { itemId: number; data: BodyType<CartItemUpdate> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof updateCartItem>>,
  TError,
  { itemId: number; data: BodyType<CartItemUpdate> },
  TContext
> => {
  const mutationKey = ["updateCartItem"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof updateCartItem>>,
    { itemId: number; data: BodyType<CartItemUpdate> }
  > = (props) => {
    const { itemId, data } = props ?? {};

    return updateCartItem(itemId, data, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type UpdateCartItemMutationResult = NonNullable<
  Awaited<ReturnType<typeof updateCartItem>>
>;
export type UpdateCartItemMutationBody = BodyType<CartItemUpdate>;
export type UpdateCartItemMutationError = ErrorType<unknown>;

/**
 * @summary Update cart item quantity
 */
export const useUpdateCartItem = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof updateCartItem>>,
    TError,
    { itemId: number; data: BodyType<CartItemUpdate> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof updateCartItem>>,
  TError,
  { itemId: number; data: BodyType<CartItemUpdate> },
  TContext
> => {
  return useMutation(getUpdateCartItemMutationOptions(options));
};

/**
 * @summary Remove item from cart
 */
export const getRemoveCartItemUrl = (itemId: number) => {
  return `/api/cart/${itemId}`;
};

export const removeCartItem = async (
  itemId: number,
  options?: RequestInit,
): Promise<Cart> => {
  return customFetch<Cart>(getRemoveCartItemUrl(itemId), {
    ...options,
    method: "DELETE",
  });
};

export const getRemoveCartItemMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof removeCartItem>>,
    TError,
    { itemId: number },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof removeCartItem>>,
  TError,
  { itemId: number },
  TContext
> => {
  const mutationKey = ["removeCartItem"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof removeCartItem>>,
    { itemId: number }
  > = (props) => {
    const { itemId } = props ?? {};

    return removeCartItem(itemId, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type RemoveCartItemMutationResult = NonNullable<
  Awaited<ReturnType<typeof removeCartItem>>
>;

export type RemoveCartItemMutationError = ErrorType<unknown>;

/**
 * @summary Remove item from cart
 */
export const useRemoveCartItem = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof removeCartItem>>,
    TError,
    { itemId: number },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof removeCartItem>>,
  TError,
  { itemId: number },
  TContext
> => {
  return useMutation(getRemoveCartItemMutationOptions(options));
};

/**
 * @summary List orders (admin or customer own)
 */
export const getListOrdersUrl = (params?: ListOrdersParams) => {
  const normalizedParams = new URLSearchParams();

  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined) {
      normalizedParams.append(key, value === null ? "null" : value.toString());
    }
  });

  const stringifiedParams = normalizedParams.toString();

  return stringifiedParams.length > 0
    ? `/api/orders?${stringifiedParams}`
    : `/api/orders`;
};

export const listOrders = async (
  params?: ListOrdersParams,
  options?: RequestInit,
): Promise<Order[]> => {
  return customFetch<Order[]>(getListOrdersUrl(params), {
    ...options,
    method: "GET",
  });
};

export const getListOrdersQueryKey = (params?: ListOrdersParams) => {
  return [`/api/orders`, ...(params ? [params] : [])] as const;
};

export const getListOrdersQueryOptions = <
  TData = Awaited<ReturnType<typeof listOrders>>,
  TError = ErrorType<unknown>,
>(
  params?: ListOrdersParams,
  options?: {
    query?: UseQueryOptions<
      Awaited<ReturnType<typeof listOrders>>,
      TError,
      TData
    >;
    request?: SecondParameter<typeof customFetch>;
  },
) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getListOrdersQueryKey(params);

  const queryFn: QueryFunction<Awaited<ReturnType<typeof listOrders>>> = ({
    signal,
  }) => listOrders(params, { signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof listOrders>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type ListOrdersQueryResult = NonNullable<
  Awaited<ReturnType<typeof listOrders>>
>;
export type ListOrdersQueryError = ErrorType<unknown>;

/**
 * @summary List orders (admin or customer own)
 */

export function useListOrders<
  TData = Awaited<ReturnType<typeof listOrders>>,
  TError = ErrorType<unknown>,
>(
  params?: ListOrdersParams,
  options?: {
    query?: UseQueryOptions<
      Awaited<ReturnType<typeof listOrders>>,
      TError,
      TData
    >;
    request?: SecondParameter<typeof customFetch>;
  },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getListOrdersQueryOptions(params, options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Create order from cart
 */
export const getCreateOrderUrl = () => {
  return `/api/orders`;
};

export const createOrder = async (
  orderInput: OrderInput,
  options?: RequestInit,
): Promise<Order> => {
  return customFetch<Order>(getCreateOrderUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(orderInput),
  });
};

export const getCreateOrderMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof createOrder>>,
    TError,
    { data: BodyType<OrderInput> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof createOrder>>,
  TError,
  { data: BodyType<OrderInput> },
  TContext
> => {
  const mutationKey = ["createOrder"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof createOrder>>,
    { data: BodyType<OrderInput> }
  > = (props) => {
    const { data } = props ?? {};

    return createOrder(data, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type CreateOrderMutationResult = NonNullable<
  Awaited<ReturnType<typeof createOrder>>
>;
export type CreateOrderMutationBody = BodyType<OrderInput>;
export type CreateOrderMutationError = ErrorType<unknown>;

/**
 * @summary Create order from cart
 */
export const useCreateOrder = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof createOrder>>,
    TError,
    { data: BodyType<OrderInput> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof createOrder>>,
  TError,
  { data: BodyType<OrderInput> },
  TContext
> => {
  return useMutation(getCreateOrderMutationOptions(options));
};

/**
 * @summary Get order by ID
 */
export const getGetOrderUrl = (id: number) => {
  return `/api/orders/${id}`;
};

export const getOrder = async (
  id: number,
  options?: RequestInit,
): Promise<Order> => {
  return customFetch<Order>(getGetOrderUrl(id), {
    ...options,
    method: "GET",
  });
};

export const getGetOrderQueryKey = (id: number) => {
  return [`/api/orders/${id}`] as const;
};

export const getGetOrderQueryOptions = <
  TData = Awaited<ReturnType<typeof getOrder>>,
  TError = ErrorType<unknown>,
>(
  id: number,
  options?: {
    query?: UseQueryOptions<
      Awaited<ReturnType<typeof getOrder>>,
      TError,
      TData
    >;
    request?: SecondParameter<typeof customFetch>;
  },
) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getGetOrderQueryKey(id);

  const queryFn: QueryFunction<Awaited<ReturnType<typeof getOrder>>> = ({
    signal,
  }) => getOrder(id, { signal, ...requestOptions });

  return {
    queryKey,
    queryFn,
    enabled: !!id,
    ...queryOptions,
  } as UseQueryOptions<Awaited<ReturnType<typeof getOrder>>, TError, TData> & {
    queryKey: QueryKey;
  };
};

export type GetOrderQueryResult = NonNullable<
  Awaited<ReturnType<typeof getOrder>>
>;
export type GetOrderQueryError = ErrorType<unknown>;

/**
 * @summary Get order by ID
 */

export function useGetOrder<
  TData = Awaited<ReturnType<typeof getOrder>>,
  TError = ErrorType<unknown>,
>(
  id: number,
  options?: {
    query?: UseQueryOptions<
      Awaited<ReturnType<typeof getOrder>>,
      TError,
      TData
    >;
    request?: SecondParameter<typeof customFetch>;
  },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetOrderQueryOptions(id, options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Update order status (admin)
 */
export const getUpdateOrderStatusUrl = (id: number) => {
  return `/api/orders/${id}`;
};

export const updateOrderStatus = async (
  id: number,
  orderStatusUpdate: OrderStatusUpdate,
  options?: RequestInit,
): Promise<Order> => {
  return customFetch<Order>(getUpdateOrderStatusUrl(id), {
    ...options,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(orderStatusUpdate),
  });
};

export const getUpdateOrderStatusMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof updateOrderStatus>>,
    TError,
    { id: number; data: BodyType<OrderStatusUpdate> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof updateOrderStatus>>,
  TError,
  { id: number; data: BodyType<OrderStatusUpdate> },
  TContext
> => {
  const mutationKey = ["updateOrderStatus"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof updateOrderStatus>>,
    { id: number; data: BodyType<OrderStatusUpdate> }
  > = (props) => {
    const { id, data } = props ?? {};

    return updateOrderStatus(id, data, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type UpdateOrderStatusMutationResult = NonNullable<
  Awaited<ReturnType<typeof updateOrderStatus>>
>;
export type UpdateOrderStatusMutationBody = BodyType<OrderStatusUpdate>;
export type UpdateOrderStatusMutationError = ErrorType<unknown>;

/**
 * @summary Update order status (admin)
 */
export const useUpdateOrderStatus = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof updateOrderStatus>>,
    TError,
    { id: number; data: BodyType<OrderStatusUpdate> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof updateOrderStatus>>,
  TError,
  { id: number; data: BodyType<OrderStatusUpdate> },
  TContext
> => {
  return useMutation(getUpdateOrderStatusMutationOptions(options));
};

/**
 * @summary Track order by tracking code (public)
 */
export const getTrackOrderUrl = (trackingCode: string) => {
  return `/api/orders/track/${trackingCode}`;
};

export const trackOrder = async (
  trackingCode: string,
  options?: RequestInit,
): Promise<OrderTracking> => {
  return customFetch<OrderTracking>(getTrackOrderUrl(trackingCode), {
    ...options,
    method: "GET",
  });
};

export const getTrackOrderQueryKey = (trackingCode: string) => {
  return [`/api/orders/track/${trackingCode}`] as const;
};

export const getTrackOrderQueryOptions = <
  TData = Awaited<ReturnType<typeof trackOrder>>,
  TError = ErrorType<unknown>,
>(
  trackingCode: string,
  options?: {
    query?: UseQueryOptions<
      Awaited<ReturnType<typeof trackOrder>>,
      TError,
      TData
    >;
    request?: SecondParameter<typeof customFetch>;
  },
) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey =
    queryOptions?.queryKey ?? getTrackOrderQueryKey(trackingCode);

  const queryFn: QueryFunction<Awaited<ReturnType<typeof trackOrder>>> = ({
    signal,
  }) => trackOrder(trackingCode, { signal, ...requestOptions });

  return {
    queryKey,
    queryFn,
    enabled: !!trackingCode,
    ...queryOptions,
  } as UseQueryOptions<
    Awaited<ReturnType<typeof trackOrder>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type TrackOrderQueryResult = NonNullable<
  Awaited<ReturnType<typeof trackOrder>>
>;
export type TrackOrderQueryError = ErrorType<unknown>;

/**
 * @summary Track order by tracking code (public)
 */

export function useTrackOrder<
  TData = Awaited<ReturnType<typeof trackOrder>>,
  TError = ErrorType<unknown>,
>(
  trackingCode: string,
  options?: {
    query?: UseQueryOptions<
      Awaited<ReturnType<typeof trackOrder>>,
      TError,
      TData
    >;
    request?: SecondParameter<typeof customFetch>;
  },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getTrackOrderQueryOptions(trackingCode, options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Find orders by last 4 digits of phone (public)
 */
export const getTrackOrdersByPhoneUrl = (last4: string) => {
  return `/api/orders/track-by-phone/${last4}`;
};

export const trackOrdersByPhone = async (
  last4: string,
  options?: RequestInit,
): Promise<OrderTracking[]> => {
  return customFetch<OrderTracking[]>(getTrackOrdersByPhoneUrl(last4), {
    ...options,
    method: "GET",
  });
};

export const getTrackOrdersByPhoneQueryKey = (last4: string) => {
  return [`/api/orders/track-by-phone/${last4}`] as const;
};

export const getTrackOrdersByPhoneQueryOptions = <
  TData = Awaited<ReturnType<typeof trackOrdersByPhone>>,
  TError = ErrorType<unknown>,
>(
  last4: string,
  options?: {
    query?: UseQueryOptions<
      Awaited<ReturnType<typeof trackOrdersByPhone>>,
      TError,
      TData
    >;
    request?: SecondParameter<typeof customFetch>;
  },
) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey =
    queryOptions?.queryKey ?? getTrackOrdersByPhoneQueryKey(last4);

  const queryFn: QueryFunction<
    Awaited<ReturnType<typeof trackOrdersByPhone>>
  > = ({ signal }) => trackOrdersByPhone(last4, { signal, ...requestOptions });

  return {
    queryKey,
    queryFn,
    enabled: !!last4,
    ...queryOptions,
  } as UseQueryOptions<
    Awaited<ReturnType<typeof trackOrdersByPhone>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type TrackOrdersByPhoneQueryResult = NonNullable<
  Awaited<ReturnType<typeof trackOrdersByPhone>>
>;
export type TrackOrdersByPhoneQueryError = ErrorType<unknown>;

/**
 * @summary Find orders by last 4 digits of phone (public)
 */

export function useTrackOrdersByPhone<
  TData = Awaited<ReturnType<typeof trackOrdersByPhone>>,
  TError = ErrorType<unknown>,
>(
  last4: string,
  options?: {
    query?: UseQueryOptions<
      Awaited<ReturnType<typeof trackOrdersByPhone>>,
      TError,
      TData
    >;
    request?: SecondParameter<typeof customFetch>;
  },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getTrackOrdersByPhoneQueryOptions(last4, options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Get current customer orders
 */
export const getGetMyOrdersUrl = () => {
  return `/api/orders/my`;
};

export const getMyOrders = async (options?: RequestInit): Promise<Order[]> => {
  return customFetch<Order[]>(getGetMyOrdersUrl(), {
    ...options,
    method: "GET",
  });
};

export const getGetMyOrdersQueryKey = () => {
  return [`/api/orders/my`] as const;
};

export const getGetMyOrdersQueryOptions = <
  TData = Awaited<ReturnType<typeof getMyOrders>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getMyOrders>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getGetMyOrdersQueryKey();

  const queryFn: QueryFunction<Awaited<ReturnType<typeof getMyOrders>>> = ({
    signal,
  }) => getMyOrders({ signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof getMyOrders>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type GetMyOrdersQueryResult = NonNullable<
  Awaited<ReturnType<typeof getMyOrders>>
>;
export type GetMyOrdersQueryError = ErrorType<unknown>;

/**
 * @summary Get current customer orders
 */

export function useGetMyOrders<
  TData = Awaited<ReturnType<typeof getMyOrders>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getMyOrders>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetMyOrdersQueryOptions(options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary List gallery items
 */
export const getListGalleryUrl = (params?: ListGalleryParams) => {
  const normalizedParams = new URLSearchParams();

  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined) {
      normalizedParams.append(key, value === null ? "null" : value.toString());
    }
  });

  const stringifiedParams = normalizedParams.toString();

  return stringifiedParams.length > 0
    ? `/api/gallery?${stringifiedParams}`
    : `/api/gallery`;
};

export const listGallery = async (
  params?: ListGalleryParams,
  options?: RequestInit,
): Promise<GalleryItem[]> => {
  return customFetch<GalleryItem[]>(getListGalleryUrl(params), {
    ...options,
    method: "GET",
  });
};

export const getListGalleryQueryKey = (params?: ListGalleryParams) => {
  return [`/api/gallery`, ...(params ? [params] : [])] as const;
};

export const getListGalleryQueryOptions = <
  TData = Awaited<ReturnType<typeof listGallery>>,
  TError = ErrorType<unknown>,
>(
  params?: ListGalleryParams,
  options?: {
    query?: UseQueryOptions<
      Awaited<ReturnType<typeof listGallery>>,
      TError,
      TData
    >;
    request?: SecondParameter<typeof customFetch>;
  },
) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getListGalleryQueryKey(params);

  const queryFn: QueryFunction<Awaited<ReturnType<typeof listGallery>>> = ({
    signal,
  }) => listGallery(params, { signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof listGallery>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type ListGalleryQueryResult = NonNullable<
  Awaited<ReturnType<typeof listGallery>>
>;
export type ListGalleryQueryError = ErrorType<unknown>;

/**
 * @summary List gallery items
 */

export function useListGallery<
  TData = Awaited<ReturnType<typeof listGallery>>,
  TError = ErrorType<unknown>,
>(
  params?: ListGalleryParams,
  options?: {
    query?: UseQueryOptions<
      Awaited<ReturnType<typeof listGallery>>,
      TError,
      TData
    >;
    request?: SecondParameter<typeof customFetch>;
  },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getListGalleryQueryOptions(params, options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Create gallery item (admin)
 */
export const getCreateGalleryItemUrl = () => {
  return `/api/gallery`;
};

export const createGalleryItem = async (
  galleryItemInput: GalleryItemInput,
  options?: RequestInit,
): Promise<GalleryItem> => {
  return customFetch<GalleryItem>(getCreateGalleryItemUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(galleryItemInput),
  });
};

export const getCreateGalleryItemMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof createGalleryItem>>,
    TError,
    { data: BodyType<GalleryItemInput> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof createGalleryItem>>,
  TError,
  { data: BodyType<GalleryItemInput> },
  TContext
> => {
  const mutationKey = ["createGalleryItem"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof createGalleryItem>>,
    { data: BodyType<GalleryItemInput> }
  > = (props) => {
    const { data } = props ?? {};

    return createGalleryItem(data, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type CreateGalleryItemMutationResult = NonNullable<
  Awaited<ReturnType<typeof createGalleryItem>>
>;
export type CreateGalleryItemMutationBody = BodyType<GalleryItemInput>;
export type CreateGalleryItemMutationError = ErrorType<unknown>;

/**
 * @summary Create gallery item (admin)
 */
export const useCreateGalleryItem = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof createGalleryItem>>,
    TError,
    { data: BodyType<GalleryItemInput> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof createGalleryItem>>,
  TError,
  { data: BodyType<GalleryItemInput> },
  TContext
> => {
  return useMutation(getCreateGalleryItemMutationOptions(options));
};

/**
 * @summary Delete gallery item (admin)
 */
export const getDeleteGalleryItemUrl = (id: number) => {
  return `/api/gallery/${id}`;
};

export const deleteGalleryItem = async (
  id: number,
  options?: RequestInit,
): Promise<MessageResponse> => {
  return customFetch<MessageResponse>(getDeleteGalleryItemUrl(id), {
    ...options,
    method: "DELETE",
  });
};

export const getDeleteGalleryItemMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof deleteGalleryItem>>,
    TError,
    { id: number },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof deleteGalleryItem>>,
  TError,
  { id: number },
  TContext
> => {
  const mutationKey = ["deleteGalleryItem"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof deleteGalleryItem>>,
    { id: number }
  > = (props) => {
    const { id } = props ?? {};

    return deleteGalleryItem(id, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type DeleteGalleryItemMutationResult = NonNullable<
  Awaited<ReturnType<typeof deleteGalleryItem>>
>;

export type DeleteGalleryItemMutationError = ErrorType<unknown>;

/**
 * @summary Delete gallery item (admin)
 */
export const useDeleteGalleryItem = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof deleteGalleryItem>>,
    TError,
    { id: number },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof deleteGalleryItem>>,
  TError,
  { id: number },
  TContext
> => {
  return useMutation(getDeleteGalleryItemMutationOptions(options));
};

/**
 * @summary List gallery categories
 */
export const getListGalleryCategoriesUrl = () => {
  return `/api/gallery/categories`;
};

export const listGalleryCategories = async (
  options?: RequestInit,
): Promise<CategoryItem[]> => {
  return customFetch<CategoryItem[]>(getListGalleryCategoriesUrl(), {
    ...options,
    method: "GET",
  });
};

export const getListGalleryCategoriesQueryKey = () => {
  return [`/api/gallery/categories`] as const;
};

export const getListGalleryCategoriesQueryOptions = <
  TData = Awaited<ReturnType<typeof listGalleryCategories>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof listGalleryCategories>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getListGalleryCategoriesQueryKey();

  const queryFn: QueryFunction<
    Awaited<ReturnType<typeof listGalleryCategories>>
  > = ({ signal }) => listGalleryCategories({ signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof listGalleryCategories>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type ListGalleryCategoriesQueryResult = NonNullable<
  Awaited<ReturnType<typeof listGalleryCategories>>
>;
export type ListGalleryCategoriesQueryError = ErrorType<unknown>;

/**
 * @summary List gallery categories
 */

export function useListGalleryCategories<
  TData = Awaited<ReturnType<typeof listGalleryCategories>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof listGalleryCategories>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getListGalleryCategoriesQueryOptions(options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary List reviews for a product
 */
export const getListReviewsUrl = (params: ListReviewsParams) => {
  const normalizedParams = new URLSearchParams();

  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined) {
      normalizedParams.append(key, value === null ? "null" : value.toString());
    }
  });

  const stringifiedParams = normalizedParams.toString();

  return stringifiedParams.length > 0
    ? `/api/reviews?${stringifiedParams}`
    : `/api/reviews`;
};

export const listReviews = async (
  params: ListReviewsParams,
  options?: RequestInit,
): Promise<Review[]> => {
  return customFetch<Review[]>(getListReviewsUrl(params), {
    ...options,
    method: "GET",
  });
};

export const getListReviewsQueryKey = (params?: ListReviewsParams) => {
  return [`/api/reviews`, ...(params ? [params] : [])] as const;
};

export const getListReviewsQueryOptions = <
  TData = Awaited<ReturnType<typeof listReviews>>,
  TError = ErrorType<unknown>,
>(
  params: ListReviewsParams,
  options?: {
    query?: UseQueryOptions<
      Awaited<ReturnType<typeof listReviews>>,
      TError,
      TData
    >;
    request?: SecondParameter<typeof customFetch>;
  },
) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getListReviewsQueryKey(params);

  const queryFn: QueryFunction<Awaited<ReturnType<typeof listReviews>>> = ({
    signal,
  }) => listReviews(params, { signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof listReviews>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type ListReviewsQueryResult = NonNullable<
  Awaited<ReturnType<typeof listReviews>>
>;
export type ListReviewsQueryError = ErrorType<unknown>;

/**
 * @summary List reviews for a product
 */

export function useListReviews<
  TData = Awaited<ReturnType<typeof listReviews>>,
  TError = ErrorType<unknown>,
>(
  params: ListReviewsParams,
  options?: {
    query?: UseQueryOptions<
      Awaited<ReturnType<typeof listReviews>>,
      TError,
      TData
    >;
    request?: SecondParameter<typeof customFetch>;
  },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getListReviewsQueryOptions(params, options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Create a review
 */
export const getCreateReviewUrl = () => {
  return `/api/reviews`;
};

export const createReview = async (
  reviewInput: ReviewInput,
  options?: RequestInit,
): Promise<Review> => {
  return customFetch<Review>(getCreateReviewUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(reviewInput),
  });
};

export const getCreateReviewMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof createReview>>,
    TError,
    { data: BodyType<ReviewInput> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof createReview>>,
  TError,
  { data: BodyType<ReviewInput> },
  TContext
> => {
  const mutationKey = ["createReview"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof createReview>>,
    { data: BodyType<ReviewInput> }
  > = (props) => {
    const { data } = props ?? {};

    return createReview(data, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type CreateReviewMutationResult = NonNullable<
  Awaited<ReturnType<typeof createReview>>
>;
export type CreateReviewMutationBody = BodyType<ReviewInput>;
export type CreateReviewMutationError = ErrorType<unknown>;

/**
 * @summary Create a review
 */
export const useCreateReview = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof createReview>>,
    TError,
    { data: BodyType<ReviewInput> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof createReview>>,
  TError,
  { data: BodyType<ReviewInput> },
  TContext
> => {
  return useMutation(getCreateReviewMutationOptions(options));
};

/**
 * @summary List all delivery zones (governorates/areas)
 */
export const getListDeliveryZonesUrl = () => {
  return `/api/delivery-zones`;
};

export const listDeliveryZones = async (
  options?: RequestInit,
): Promise<DeliveryZone[]> => {
  return customFetch<DeliveryZone[]>(getListDeliveryZonesUrl(), {
    ...options,
    method: "GET",
  });
};

export const getListDeliveryZonesQueryKey = () => {
  return [`/api/delivery-zones`] as const;
};

export const getListDeliveryZonesQueryOptions = <
  TData = Awaited<ReturnType<typeof listDeliveryZones>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof listDeliveryZones>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getListDeliveryZonesQueryKey();

  const queryFn: QueryFunction<
    Awaited<ReturnType<typeof listDeliveryZones>>
  > = ({ signal }) => listDeliveryZones({ signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof listDeliveryZones>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type ListDeliveryZonesQueryResult = NonNullable<
  Awaited<ReturnType<typeof listDeliveryZones>>
>;
export type ListDeliveryZonesQueryError = ErrorType<unknown>;

/**
 * @summary List all delivery zones (governorates/areas)
 */

export function useListDeliveryZones<
  TData = Awaited<ReturnType<typeof listDeliveryZones>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof listDeliveryZones>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getListDeliveryZonesQueryOptions(options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Create delivery zone (admin)
 */
export const getCreateDeliveryZoneUrl = () => {
  return `/api/delivery-zones`;
};

export const createDeliveryZone = async (
  deliveryZoneInput: DeliveryZoneInput,
  options?: RequestInit,
): Promise<DeliveryZone> => {
  return customFetch<DeliveryZone>(getCreateDeliveryZoneUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(deliveryZoneInput),
  });
};

export const getCreateDeliveryZoneMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof createDeliveryZone>>,
    TError,
    { data: BodyType<DeliveryZoneInput> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof createDeliveryZone>>,
  TError,
  { data: BodyType<DeliveryZoneInput> },
  TContext
> => {
  const mutationKey = ["createDeliveryZone"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof createDeliveryZone>>,
    { data: BodyType<DeliveryZoneInput> }
  > = (props) => {
    const { data } = props ?? {};

    return createDeliveryZone(data, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type CreateDeliveryZoneMutationResult = NonNullable<
  Awaited<ReturnType<typeof createDeliveryZone>>
>;
export type CreateDeliveryZoneMutationBody = BodyType<DeliveryZoneInput>;
export type CreateDeliveryZoneMutationError = ErrorType<unknown>;

/**
 * @summary Create delivery zone (admin)
 */
export const useCreateDeliveryZone = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof createDeliveryZone>>,
    TError,
    { data: BodyType<DeliveryZoneInput> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof createDeliveryZone>>,
  TError,
  { data: BodyType<DeliveryZoneInput> },
  TContext
> => {
  return useMutation(getCreateDeliveryZoneMutationOptions(options));
};

/**
 * @summary Update delivery zone (admin)
 */
export const getUpdateDeliveryZoneUrl = (id: number) => {
  return `/api/delivery-zones/${id}`;
};

export const updateDeliveryZone = async (
  id: number,
  deliveryZoneUpdate: DeliveryZoneUpdate,
  options?: RequestInit,
): Promise<DeliveryZone> => {
  return customFetch<DeliveryZone>(getUpdateDeliveryZoneUrl(id), {
    ...options,
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(deliveryZoneUpdate),
  });
};

export const getUpdateDeliveryZoneMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof updateDeliveryZone>>,
    TError,
    { id: number; data: BodyType<DeliveryZoneUpdate> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationOptions<
  Awaited<ReturnType<typeof updateDeliveryZone>>,
  TError,
  { id: number; data: BodyType<DeliveryZoneUpdate> },
  TContext
> => {
  const mutationKey = ["updateDeliveryZone"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation &&
      "mutationKey" in options.mutation &&
      options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };

  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof updateDeliveryZone>>,
    { id: number; data: BodyType<DeliveryZoneUpdate> }
  > = (props) => {
    const { id, data } = props ?? {};

    return updateDeliveryZone(id, data, requestOptions);
  };

  return { mutationFn, ...mutationOptions };
};

export type UpdateDeliveryZoneMutationResult = NonNullable<
  Awaited<ReturnType<typeof updateDeliveryZone>>
>;
export type UpdateDeliveryZoneMutationBody = BodyType<DeliveryZoneUpdate>;
export type UpdateDeliveryZoneMutationError = ErrorType<unknown>;

/**
 * @summary Update delivery zone (admin)
 */
export const useUpdateDeliveryZone = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof updateDeliveryZone>>,
    TError,
    { id: number; data: BodyType<DeliveryZoneUpdate> },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof updateDeliveryZone>>,
  TError,
  { id: number; data: BodyType<DeliveryZoneUpdate> },
  TContext
> => {
  return useMutation(getUpdateDeliveryZoneMutationOptions(options));
};

/**
 * @summary Get admin dashboard statistics
 */
export const getGetDashboardStatsUrl = () => {
  return `/api/dashboard/stats`;
};

export const getDashboardStats = async (
  options?: RequestInit,
): Promise<DashboardStats> => {
  return customFetch<DashboardStats>(getGetDashboardStatsUrl(), {
    ...options,
    method: "GET",
  });
};

export const getGetDashboardStatsQueryKey = () => {
  return [`/api/dashboard/stats`] as const;
};

export const getGetDashboardStatsQueryOptions = <
  TData = Awaited<ReturnType<typeof getDashboardStats>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getDashboardStats>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getGetDashboardStatsQueryKey();

  const queryFn: QueryFunction<
    Awaited<ReturnType<typeof getDashboardStats>>
  > = ({ signal }) => getDashboardStats({ signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof getDashboardStats>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type GetDashboardStatsQueryResult = NonNullable<
  Awaited<ReturnType<typeof getDashboardStats>>
>;
export type GetDashboardStatsQueryError = ErrorType<unknown>;

/**
 * @summary Get admin dashboard statistics
 */

export function useGetDashboardStats<
  TData = Awaited<ReturnType<typeof getDashboardStats>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getDashboardStats>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetDashboardStatsQueryOptions(options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Get recent orders for dashboard
 */
export const getGetRecentOrdersUrl = () => {
  return `/api/dashboard/recent-orders`;
};

export const getRecentOrders = async (
  options?: RequestInit,
): Promise<Order[]> => {
  return customFetch<Order[]>(getGetRecentOrdersUrl(), {
    ...options,
    method: "GET",
  });
};

export const getGetRecentOrdersQueryKey = () => {
  return [`/api/dashboard/recent-orders`] as const;
};

export const getGetRecentOrdersQueryOptions = <
  TData = Awaited<ReturnType<typeof getRecentOrders>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getRecentOrders>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey = queryOptions?.queryKey ?? getGetRecentOrdersQueryKey();

  const queryFn: QueryFunction<Awaited<ReturnType<typeof getRecentOrders>>> = ({
    signal,
  }) => getRecentOrders({ signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof getRecentOrders>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type GetRecentOrdersQueryResult = NonNullable<
  Awaited<ReturnType<typeof getRecentOrders>>
>;
export type GetRecentOrdersQueryError = ErrorType<unknown>;

/**
 * @summary Get recent orders for dashboard
 */

export function useGetRecentOrders<
  TData = Awaited<ReturnType<typeof getRecentOrders>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getRecentOrders>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetRecentOrdersQueryOptions(options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}

/**
 * @summary Orders grouped by status
 */
export const getGetOrderStatusBreakdownUrl = () => {
  return `/api/dashboard/order-status-breakdown`;
};

export const getOrderStatusBreakdown = async (
  options?: RequestInit,
): Promise<StatusCount[]> => {
  return customFetch<StatusCount[]>(getGetOrderStatusBreakdownUrl(), {
    ...options,
    method: "GET",
  });
};

export const getGetOrderStatusBreakdownQueryKey = () => {
  return [`/api/dashboard/order-status-breakdown`] as const;
};

export const getGetOrderStatusBreakdownQueryOptions = <
  TData = Awaited<ReturnType<typeof getOrderStatusBreakdown>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getOrderStatusBreakdown>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};

  const queryKey =
    queryOptions?.queryKey ?? getGetOrderStatusBreakdownQueryKey();

  const queryFn: QueryFunction<
    Awaited<ReturnType<typeof getOrderStatusBreakdown>>
  > = ({ signal }) => getOrderStatusBreakdown({ signal, ...requestOptions });

  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof getOrderStatusBreakdown>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export type GetOrderStatusBreakdownQueryResult = NonNullable<
  Awaited<ReturnType<typeof getOrderStatusBreakdown>>
>;
export type GetOrderStatusBreakdownQueryError = ErrorType<unknown>;

/**
 * @summary Orders grouped by status
 */

export function useGetOrderStatusBreakdown<
  TData = Awaited<ReturnType<typeof getOrderStatusBreakdown>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<
    Awaited<ReturnType<typeof getOrderStatusBreakdown>>,
    TError,
    TData
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getGetOrderStatusBreakdownQueryOptions(options);

  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };

  return { ...query, queryKey: queryOptions.queryKey };
}
