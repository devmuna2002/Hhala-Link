// ============================================================
// HLALA LINK — POSTGRESQL / NODE.JS FRONTEND ADAPTER
// ============================================================
// Keeps the existing Supabase-style frontend API:
//
//   sb().from("properties").select(...)
//   sb().from("applications").select(...)
//   sb().from("profiles").select(...)
//   client.auth.signInWithPassword(...)
//   client.auth.signUp(...)
//
// but sends requests to our own Node.js backend.
//
// ============================================================

const HLALA_API_URL = (
    (typeof window !== "undefined" && window.HLALA_API_URL) ||
    "https://hlala.raisdaglobal.co.zw/api"
).replace(/\/$/, "");

// Absolute site base for same-origin fetches elsewhere (push, contact).
// Set before app-15.js loads so its relative /api/* calls keep working
// when the frontend is hosted on a different origin than the API.
if (typeof window !== "undefined") {
    window.HLALA_API_BASE = HLALA_API_URL.replace(/\/api$/, "");
}


// ============================================================
// SESSION STORAGE
// ============================================================

const TOKEN_KEY = "hlala_link_token";
const USER_KEY = "hlala_link_user";

function getToken() {
    return localStorage.getItem(TOKEN_KEY);
}

function getStoredUser() {
    try {
        const raw = localStorage.getItem(USER_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function storeSession(token, user) {

    if (token) {
        localStorage.setItem(TOKEN_KEY, token);
    }

    if (user) {
        localStorage.setItem(
            USER_KEY,
            JSON.stringify(user)
        );
    }
}

function clearSession() {

    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
}


// ============================================================
// API REQUEST HELPER
// ============================================================

async function apiRequest(path, options = {}) {

    const headers = {
        "Content-Type": "application/json",
        ...(options.headers || {})
    };

    const token = getToken();

    if (token) {
        headers.Authorization =
            `Bearer ${token}`;
    }

    try {

        const response = await fetch(
            `${HLALA_API_URL}${path}`,
            {
                ...options,
                headers
            }
        );

        let data = {};

        try {
            data = await response.json();
        } catch {
            data = {};
        }

        if (!response.ok) {

            return {
                data: null,

                error: {
                    message:
                        data.message ||
                        data.error ||
                        `Request failed with status ${response.status}`,

                    status:
                        response.status
                }
            };
        }

        return {
            data,
            error: null
        };

    } catch (error) {

        console.error(
            "[Hlala Link API]",
            error
        );

        return {
            data: null,

            error: {
                message:
                    "Could not connect to the Hlala Link server. Make sure the Node.js backend is running.",

                original: error
            }
        };
    }
}


// ============================================================
// AUTH
// ============================================================

const authListeners = new Set();

function notifyAuth(
    event,
    user = null
) {

    const session = user
        ? {
            access_token: getToken(),
            user
        }
        : null;

    authListeners.forEach(
        callback => {

            try {
                callback(
                    event,
                    session
                );
            } catch (error) {

                console.error(
                    "[Auth listener error]",
                    error
                );
            }
        }
    );
}


const HlalaAuth = {

    // --------------------------------------------------------
    // GET SESSION
    // --------------------------------------------------------

    async getSession() {

        const token =
            getToken();

        const storedUser =
            getStoredUser();

        if (
            !token ||
            !storedUser
        ) {

            return {
                data: {
                    session: null
                },
                error: null
            };
        }

        const result =
            await apiRequest(
                "/profiles/me"
            );

        if (result.error) {

            if (
                result.error.status === 401 ||
                result.error.status === 403
            ) {

                clearSession();

                notifyAuth(
                    "SIGNED_OUT",
                    null
                );

                return {
                    data: {
                        session: null
                    },
                    error: null
                };
            }

            return {
                data: {
                    session: {
                        access_token: token,
                        user: storedUser
                    }
                },
                error: null
            };
        }

        const user =
            result.data?.user ||
            storedUser;

        storeSession(
            token,
            user
        );

        return {
            data: {
                session: {
                    access_token: token,
                    user
                }
            },
            error: null
        };
    },


    // --------------------------------------------------------
    // AUTH STATE CHANGE
    // --------------------------------------------------------

    onAuthStateChange(callback) {

        if (
            typeof callback !==
            "function"
        ) {

            return {
                data: {
                    subscription: {
                        unsubscribe() { }
                    }
                }
            };
        }

        authListeners.add(
            callback
        );

        return {
            data: {
                subscription: {

                    unsubscribe() {

                        authListeners.delete(
                            callback
                        );
                    }
                }
            }
        };
    },


    // --------------------------------------------------------
    // LOGIN
    // --------------------------------------------------------

    async signInWithPassword({
        email,
        password
    }) {

        const result =
            await apiRequest(
                "/auth/login",
                {
                    method: "POST",

                    body: JSON.stringify({
                        email,
                        password
                    })
                }
            );

        if (result.error) {

            return {
                data: {
                    user: null,
                    session: null
                },

                error:
                    result.error
            };
        }

        const user =
            result.data.user;

        const token =
            result.data.token;

        storeSession(
            token,
            user
        );

        notifyAuth(
            "SIGNED_IN",
            user
        );

        return {
            data: {
                user,

                session: {
                    access_token: token,
                    user
                }
            },

            error: null
        };
    },


    // --------------------------------------------------------
    // SIGN UP
    // --------------------------------------------------------

    async signUp({
        email,
        password,
        options = {}
    }) {

        const metadata =
            options.data || {};

        const fullName = [

            metadata.first_name ||
            "",

            metadata.last_name ||
            ""

        ]
            .join(" ")
            .trim();

        const result =
            await apiRequest(
                "/auth/register",
                {
                    method: "POST",

                    body: JSON.stringify({

                        email,

                        password,

                        full_name:
                            fullName ||
                            email.split("@")[0],

                        phone:
                            metadata.phone_number ||
                            "",

                        role:
                            metadata.role ||
                            "tenant"
                    })
                }
            );

        if (result.error) {

            return {
                data: {
                    user: null,
                    session: null
                },

                error:
                    result.error
            };
        }

        const user =
            result.data.user;

        const token =
            result.data.token;

        storeSession(
            token,
            user
        );

        notifyAuth(
            "SIGNED_IN",
            user
        );

        return {
            data: {
                user,

                session: {
                    access_token: token,
                    user
                }
            },

            error: null
        };
    },


    // --------------------------------------------------------
    // LOGOUT
    // --------------------------------------------------------

    async signOut() {

        clearSession();

        notifyAuth(
            "SIGNED_OUT",
            null
        );

        return {
            error: null
        };
    },


    // --------------------------------------------------------
    // CURRENT USER
    // --------------------------------------------------------

    async currentUser() {

        const result =
            await this.getSession();

        return (
            result.data
                ?.session
                ?.user ||
            null
        );
    },

    // Supabase compatibility
    async getUser() {

        const user =
            await this.currentUser();

        return {
            data: {
                user
            },
            error: null
        };
    }
};


// ============================================================
// QUERY BUILDER
// ============================================================

class QueryBuilder {

    constructor(table) {

        this.table =
            table;

        this.operation =
            "select";

        this.columns =
            "*";

        this.filters =
            [];

        this.orderBy =
            null;

        this.orderAscending =
            true;

        this.limitCount =
            null;

        this.offsetCount =
            null;

        this.singleMode =
            false;

        this.maybeSingleMode =
            false;

        this.insertData =
            null;

        this.updateData =
            null;

        this.deleteMode =
            false;

        this.countMode =
            false;

        this.headMode =
            false;

        this.returnChangedRows =
            false;
    }


    // ========================================================
    // SELECT
    // ========================================================

    select(
        columns = "*",
        options = {}
    ) {

        if (
            this.operation === "insert" ||
            this.operation === "update" ||
            this.operation === "delete"
        ) {

            this.returnChangedRows =
                true;

        } else {

            this.operation =
                "select";
        }

        this.columns =
            columns || "*";

        if (options) {

            if (
                options.count ===
                "exact"
            ) {

                this.countMode =
                    true;
            }

            if (
                options.head ===
                true
            ) {

                this.headMode =
                    true;
            }
        }

        return this;
    }


    // ========================================================
    // INSERT
    // ========================================================

    insert(data) {

        this.operation =
            "insert";

        this.insertData =
            data;

        return this;
    }


    // ========================================================
    // UPDATE
    // ========================================================

    update(data) {

        this.operation =
            "update";

        this.updateData =
            data;

        return this;
    }


    // ========================================================
    // DELETE
    // ========================================================

    delete() {

        this.operation =
            "delete";

        this.deleteMode =
            true;

        return this;
    }


    // ========================================================
    // EQ
    // ========================================================

    eq(column, value) {

        this.filters.push({

            type: "eq",

            column,

            value
        });

        return this;
    }


    // ========================================================
    // NEQ
    // ========================================================

    neq(column, value) {

        this.filters.push({

            type: "neq",

            column,

            value
        });

        return this;
    }


    // ========================================================
    // IN
    // ========================================================
    // FIX FOR:
    //
    // client.from(...).select(...).in is not a function
    //
    // ========================================================

    in(column, values) {

        this.filters.push({

            type: "in",

            column,

            values:
                Array.isArray(values)
                    ? values
                    : [values]
        });

        return this;
    }


    // ========================================================
    // NOT IN
    // ========================================================

    notIn(column, values) {

        this.filters.push({

            type: "notIn",

            column,

            values:
                Array.isArray(values)
                    ? values
                    : [values]
        });

        return this;
    }


    // ========================================================
    // GT
    // ========================================================

    gt(column, value) {

        this.filters.push({

            type: "gt",

            column,

            value
        });

        return this;
    }


    // ========================================================
    // GTE
    // ========================================================

    gte(column, value) {

        this.filters.push({

            type: "gte",

            column,

            value
        });

        return this;
    }


    // ========================================================
    // LT
    // ========================================================

    lt(column, value) {

        this.filters.push({

            type: "lt",

            column,

            value
        });

        return this;
    }


    // ========================================================
    // LTE
    // ========================================================

    lte(column, value) {

        this.filters.push({

            type: "lte",

            column,

            value
        });

        return this;
    }


    // ========================================================
    // LIKE
    // ========================================================

    like(column, value) {

        this.filters.push({

            type: "like",

            column,

            value
        });

        return this;
    }


    // ========================================================
    // ILIKE
    // ========================================================

    ilike(column, value) {

        this.filters.push({

            type: "ilike",

            column,

            value
        });

        return this;
    }


    // ========================================================
    // IS
    // ========================================================

    is(column, value) {

        this.filters.push({

            type: "is",

            column,

            value
        });

        return this;
    }


    // ========================================================
    // NOT
    // ========================================================

    not(column, operator, value) {

        this.filters.push({

            type: "not",

            column,

            operator,

            value
        });

        return this;
    }


    // ========================================================
    // OR
    // ========================================================

    or(expression) {

        this.filters.push({

            type: "or",

            expression
        });

        return this;
    }


    // ========================================================
    // ORDER
    // ========================================================

    order(
        column,
        options = {}
    ) {

        this.orderBy =
            column;

        this.orderAscending =
            options.ascending !== false;

        return this;
    }


    // ========================================================
    // LIMIT
    // ========================================================

    limit(count) {

        this.limitCount =
            Number(count);

        return this;
    }


    // ========================================================
    // RANGE
    // ========================================================

    range(from, to) {

        this.offsetCount =
            Number(from);

        this.limitCount =
            Number(to) -
            Number(from) +
            1;

        return this;
    }


    // ========================================================
    // SINGLE
    // ========================================================

    single() {

        this.singleMode =
            true;

        return this;
    }


    // ========================================================
    // MAYBE SINGLE
    // ========================================================

    maybeSingle() {

        this.maybeSingleMode =
            true;

        return this;
    }


    // ========================================================
    // BUILD QUERY PARAMS
    // ========================================================

    buildQueryParams() {

        const params =
            new URLSearchParams();

        if (this.columns) {

            params.set(
                "select",
                this.columns
            );
        }

        for (
            const filter
            of this.filters
        ) {

            switch (
            filter.type
            ) {

                case "eq":

                    params.append(
                        "eq",
                        `${filter.column}:${filter.value}`
                    );

                    break;


                case "neq":

                    params.append(
                        "neq",
                        `${filter.column}:${filter.value}`
                    );

                    break;


                case "in":

                    params.append(
                        "in",
                        `${filter.column}:${filter.values.join(",")}`
                    );

                    break;


                case "notIn":

                    params.append(
                        "notIn",
                        `${filter.column}:${filter.values.join(",")}`
                    );

                    break;


                case "gt":

                    params.append(
                        "gt",
                        `${filter.column}:${filter.value}`
                    );

                    break;


                case "gte":

                    params.append(
                        "gte",
                        `${filter.column}:${filter.value}`
                    );

                    break;


                case "lt":

                    params.append(
                        "lt",
                        `${filter.column}:${filter.value}`
                    );

                    break;


                case "lte":

                    params.append(
                        "lte",
                        `${filter.column}:${filter.value}`
                    );

                    break;


                case "like":

                    params.append(
                        "like",
                        `${filter.column}:${filter.value}`
                    );

                    break;


                case "ilike":

                    params.append(
                        "ilike",
                        `${filter.column}:${filter.value}`
                    );

                    break;


                case "is":

                    params.append(
                        "is",
                        `${filter.column}:${filter.value}`
                    );

                    break;


                case "not":

                    params.append(
                        "not",
                        `${filter.column}:${filter.operator}:${filter.value}`
                    );

                    break;


                case "or":

                    params.append(
                        "or",
                        filter.expression
                    );

                    break;
            }
        }


        if (this.orderBy) {

            params.set(
                "order",
                `${this.orderBy}.${this.orderAscending ? "asc" : "desc"}`
            );
        }


        if (
            this.limitCount != null
        ) {

            params.set(
                "limit",
                String(
                    this.limitCount
                )
            );
        }


        if (
            this.offsetCount != null
        ) {

            params.set(
                "offset",
                String(
                    this.offsetCount
                )
            );
        }


        if (this.singleMode) {

            params.set(
                "single",
                "true"
            );
        }


        if (
            this.maybeSingleMode
        ) {

            params.set(
                "maybeSingle",
                "true"
            );
        }


        return params;
    }


    // ========================================================
    // EXECUTE
    // ========================================================

    async execute() {

        switch (
        this.table
        ) {

            case "properties":

                return this.executeProperties();


            case "applications":

                return this.executeApplications();


            case "profiles":

                return this.executeProfiles();


            case "saved_properties":

                return this.executeSavedProperties();


            case "conversations":

                return this.executeConversations();


            case "messages":

                return this.executeMessages();


            case "movers":

                return this.executeMovers();


            case "mover_bookings":

                return this.executeMoverBookings();


            case "notifications":

                return this.executeNotifications();


            case "reviews":

                return this.executeReviews();


            case "v_active_movers":

                return this.executeMovers();


            case "contact_submissions":

                return this.executeContactSubmissions();


            default:

                return {
                    data: [],
                    error: {
                        message:
                            `The PostgreSQL adapter does not yet support the "${this.table}" table.`
                    }
                };
        }
    }


    // ========================================================
    // PROPERTIES
    // ========================================================

    async executeProperties() {

        // ----------------------------------------------------
        // CREATE
        // ----------------------------------------------------

        if (
            this.operation ===
            "insert"
        ) {

            const result =
                await apiRequest(
                    "/properties",
                    {
                        method: "POST",

                        body:
                            JSON.stringify(
                                this.insertData
                            )
                    }
                );

            if (result.error) {
                return result;
            }

            return {
                data:
                    result.data
                        ?.property
                        ? [
                            mapProperty(
                                result.data.property
                            )
                        ]
                        : [],

                error: null
            };
        }


        // ----------------------------------------------------
        // UPDATE
        // ----------------------------------------------------

        if (
            this.operation ===
            "update"
        ) {

            const idFilter =
                this.filters.find(
                    f =>
                        f.type ===
                        "eq" &&
                        f.column ===
                        "id"
                );

            if (!idFilter) {

                return {
                    data: null,

                    error: {
                        message:
                            "Updating a property requires an id filter."
                    }
                };
            }

            const result =
                await apiRequest(
                    `/properties/${encodeURIComponent(idFilter.value)}`,
                    {
                        method: "PUT",

                        body:
                            JSON.stringify(
                                this.updateData
                            )
                    }
                );

            if (result.error) {
                return result;
            }

            return {
                data:
                    result.data
                        ?.property
                        ? [
                            mapProperty(
                                result.data.property
                            )
                        ]
                        : [],

                error: null
            };
        }


        // ----------------------------------------------------
        // DELETE
        // ----------------------------------------------------

        if (
            this.operation ===
            "delete"
        ) {

            const idFilter =
                this.filters.find(
                    f =>
                        f.type ===
                        "eq" &&
                        f.column ===
                        "id"
                );

            if (!idFilter) {

                return {
                    data: null,

                    error: {
                        message:
                            "Deleting a property requires an id filter."
                    }
                };
            }

            return apiRequest(
                `/properties/${encodeURIComponent(idFilter.value)}`,
                {
                    method: "DELETE"
                }
            );
        }


        // ----------------------------------------------------
        // SELECT ONE PROPERTY
        // ----------------------------------------------------

        const idFilter =
            this.filters.find(
                f =>
                    f.type ===
                    "eq" &&
                    f.column ===
                    "id"
            );

        if (idFilter) {

            const result =
                await apiRequest(
                    `/properties/${encodeURIComponent(idFilter.value)}`
                );

            if (result.error) {

                return {
                    data: null,
                    error:
                        result.error
                };
            }

            const property =
                result.data?.property
                    ? mapProperty(
                        result.data.property
                    )
                    : null;

            if (!property) {

                return {
                    data: null,

                    error:
                        this.singleMode
                            ? {
                                message:
                                    "Property not found"
                            }
                            : null
                };
            }

            return {
                data: property,
                error: null
            };
        }


        // ----------------------------------------------------
        // SELECT ALL
        // ----------------------------------------------------

        const result =
            await apiRequest(
                "/properties"
            );

        if (result.error) {
            return result;
        }

        let rows =
            result.data
                ?.properties ||
            [];

        rows =
            applyClientFilters(
                rows,
                this.filters
            );

        rows =
            applyClientOrder(
                rows,
                this.orderBy,
                this.orderAscending
            );

        if (
            this.offsetCount != null
        ) {

            rows =
                rows.slice(
                    this.offsetCount
                );
        }

        if (
            this.limitCount != null
        ) {

            rows =
                rows.slice(
                    0,
                    this.limitCount
                );
        }

        rows =
            rows.map(
                mapProperty
            );

        if (
            this.singleMode
        ) {

            if (
                rows.length !== 1
            ) {

                return {
                    data: null,

                    error: {
                        message:
                            "Expected exactly one property"
                    }
                };
            }

            return {
                data:
                    rows[0],

                error: null
            };
        }

        if (
            this.maybeSingleMode
        ) {

            return {
                data:
                    rows.length
                        ? rows[0]
                        : null,

                error: null
            };
        }

        return {
            data: rows,
            error: null
        };
    }


    // ========================================================
    // APPLICATIONS
    // ========================================================

    async executeApplications() {

        // ----------------------------------------------------
        // CREATE APPLICATION
        // ----------------------------------------------------

        if (
            this.operation ===
            "insert"
        ) {

            const result =
                await apiRequest(
                    "/applications",
                    {
                        method: "POST",

                        body:
                            JSON.stringify(
                                this.insertData
                            )
                    }
                );

            if (result.error) {
                return result;
            }

            return {
                data:
                    result.data
                        ?.application
                        ? [
                            mapApplication(
                                result.data.application
                            )
                        ]
                        : [],

                error: null
            };
        }


        // ----------------------------------------------------
        // UPDATE
        // ----------------------------------------------------

        if (
            this.operation ===
            "update"
        ) {

            const idFilter =
                this.filters.find(
                    f =>
                        f.type ===
                        "eq" &&
                        f.column ===
                        "id"
                );

            if (!idFilter) {

                return {
                    data: null,

                    error: {
                        message:
                            "Application update requires an id filter."
                    }
                };
            }


            if (
                this.updateData &&
                this.updateData.status
            ) {

                const result =
                    await apiRequest(
                        `/applications/${encodeURIComponent(idFilter.value)}/status`,
                        {
                            method: "PUT",

                            body:
                                JSON.stringify({
                                    status:
                                        this.updateData.status
                                })
                        }
                    );

                if (result.error) {
                    return result;
                }

                return {
                    data:
                        result.data
                            ?.application
                            ? [
                                mapApplication(
                                    result.data.application
                                )
                            ]
                            : [],

                    error: null
                };
            }
        }


        // ----------------------------------------------------
        // MY APPLICATIONS
        // ----------------------------------------------------

        const applicantFilter =
            this.filters.find(
                f =>
                    f.type ===
                    "eq" &&
                    f.column ===
                    "applicant_id"
            );

        const currentUser =
            getStoredUser();

        if (
            applicantFilter &&
            currentUser &&
            String(
                applicantFilter.value
            ) ===
            String(
                currentUser.id
            )
        ) {

            const result =
                await apiRequest(
                    "/applications/my"
                );

            if (result.error) {
                return result;
            }

            let rows =
                result.data
                    ?.applications ||
                [];

            rows =
                rows.map(
                    mapApplication
                );

            rows =
                applyClientFilters(
                    rows,
                    this.filters
                );

            if (this.orderBy) {

                rows =
                    applyClientOrder(
                        rows,
                        this.orderBy,
                        this.orderAscending
                    );
            }

            if (
                this.limitCount != null
            ) {

                rows =
                    rows.slice(
                        0,
                        this.limitCount
                    );
            }

            if (
                this.singleMode
            ) {

                if (
                    rows.length !== 1
                ) {

                    return {
                        data: null,

                        error: {
                            message:
                                "Expected exactly one application"
                        }
                    };
                }

                return {
                    data:
                        rows[0],

                    error: null
                };
            }

            if (
                this.maybeSingleMode
            ) {

                return {
                    data:
                        rows[0] ||
                        null,

                    error: null
                };
            }

            return {
                data: rows,
                error: null
            };
        }


        // ----------------------------------------------------
        // RECEIVED APPLICATIONS
        // ----------------------------------------------------

        const result =
            await apiRequest(
                "/applications/received"
            );

        if (result.error) {
            return result;
        }

        let rows =
            result.data
                ?.applications ||
            [];

        rows =
            rows.map(
                mapApplication
            );

        rows =
            applyClientFilters(
                rows,
                this.filters
            );

        if (this.orderBy) {

            rows =
                applyClientOrder(
                    rows,
                    this.orderBy,
                    this.orderAscending
                );
        }

        if (
            this.limitCount != null
        ) {

            rows =
                rows.slice(
                    0,
                    this.limitCount
                );
        }

        return {
            data: rows,
            error: null
        };
    }


    // ========================================================
    // PROFILES
    // ========================================================

    async executeProfiles() {

        const idFilter =
            this.filters.find(
                f =>
                    f.type ===
                    "eq" &&
                    f.column ===
                    "id"
            );

        // ----------------------------------------------------
        // UPDATE OWN PROFILE (push_token, bio, city, ...)
        // ----------------------------------------------------

        if (
            this.operation ===
            "update"
        ) {

            const idFilter =
                this.filters.find(
                    f =>
                        f.type ===
                        "eq" &&
                        f.column ===
                        "id"
                );

            if (
                !idFilter ||
                String(
                    idFilter.value
                ) !==
                String(
                    getStoredUser()?.id
                )
            ) {

                return {
                    data: null,

                    error: {
                        message:
                            "You can only update your own profile."
                    }
                };
            }

            const result =
                await apiRequest(
                    "/profiles/me",
                    {
                        method: "PUT",

                        body:
                            JSON.stringify(
                                this.updateData ||
                                {}
                            )
                    }
                );

            if (result.error) {

                return result;
            }

            const updated =
                mapProfile(
                    result.data
                        ?.profile
                );

            return {
                data:
                    updated
                        ? [updated]
                        : [],

                error: null
            };
        }


        // ----------------------------------------------------
        // DELETE OWN PROFILE (account removal)
        // ----------------------------------------------------

        if (
            this.operation ===
            "delete"
        ) {

            const idFilter =
                this.filters.find(
                    f =>
                        f.type ===
                        "eq" &&
                        f.column ===
                        "id"
                );

            if (
                !idFilter ||
                String(
                    idFilter.value
                ) !==
                String(
                    getStoredUser()?.id
                )
            ) {

                return {
                    data: null,

                    error: {
                        message:
                            "You can only delete your own profile."
                    }
                };
            }

            const result =
                await apiRequest(
                    "/profiles/me",
                    {
                        method: "DELETE"
                    }
                );

            if (result.error) {

                return result;
            }

            clearSession();

            return {
                data: [],
                error: null
            };
        }


        // ----------------------------------------------------
        // CURRENT PROFILE
        // ----------------------------------------------------

        if (
            idFilter &&
            String(
                idFilter.value
            ) ===
            String(
                getStoredUser()?.id
            )
        ) {

            const result =
                await apiRequest(
                    "/profiles/me"
                );

            if (result.error) {
                return result;
            }

            const profile =
                mapProfile(
                    result.data?.user
                );

            if (
                this.singleMode
            ) {

                return {
                    data: profile,
                    error: null
                };
            }

            return {
                data:
                    profile
                        ? [profile]
                        : [],

                error: null
            };
        }


        // ----------------------------------------------------
        // GENERAL PROFILE QUERY
        // ----------------------------------------------------

        const result =
            await apiRequest(
                "/profiles"
            );

        if (result.error) {
            return result;
        }

        let rows =
            result.data
                ?.profiles ||
            result.data
                ?.users ||
            [];

        rows =
            rows.map(
                mapProfile
            );


        // IMPORTANT:
        // Supports .in("role", [...])
        // and other client-side filters.

        rows =
            applyClientFilters(
                rows,
                this.filters
            );

        rows =
            applyClientOrder(
                rows,
                this.orderBy,
                this.orderAscending
            );

        if (
            this.offsetCount != null
        ) {

            rows =
                rows.slice(
                    this.offsetCount
                );
        }

        if (
            this.limitCount != null
        ) {

            rows =
                rows.slice(
                    0,
                    this.limitCount
                );
        }


        if (
            this.singleMode
        ) {

            if (
                rows.length !== 1
            ) {

                return {
                    data: null,

                    error: {
                        message:
                            "Expected exactly one profile"
                    }
                };
            }

            return {
                data:
                    rows[0],

                error: null
            };
        }


        if (
            this.maybeSingleMode
        ) {

            return {
                data:
                    rows[0] ||
                    null,

                error: null
            };
        }


        return {
            data: rows,
            error: null
        };
    }


    // ========================================================
    // SAVED PROPERTIES
    // ========================================================

    async executeSavedProperties() {

        // ----------------------------------------------------
        // GET SAVED PROPERTIES
        // ----------------------------------------------------

        if (
            this.operation ===
            "select"
        ) {

            const result =
                await apiRequest(
                    "/saved-properties"
                );

            if (
                !result.error
            ) {

                let rows =
                    result.data
                        ?.saved_properties ||
                    result.data
                        ?.savedProperties ||
                    [];

                rows =
                    applyClientFilters(
                        rows,
                        this.filters
                    );

                rows =
                    applyClientOrder(
                        rows,
                        this.orderBy,
                        this.orderAscending
                    );

                if (
                    this.limitCount != null
                ) {

                    rows =
                        rows.slice(
                            0,
                            this.limitCount
                        );
                }

                return {
                    data: rows,
                    error: null
                };
            }

            return result;
        }


        // ----------------------------------------------------
        // SAVE PROPERTY
        // ----------------------------------------------------

        if (
            this.operation ===
            "insert"
        ) {

            return apiRequest(
                "/saved-properties",
                {
                    method: "POST",

                    body:
                        JSON.stringify(
                            this.insertData
                        )
                }
            );
        }


        // ----------------------------------------------------
        // DELETE SAVED PROPERTY
        // ----------------------------------------------------

        if (
            this.operation ===
            "delete"
        ) {

            const propertyFilter =
                this.filters.find(
                    f =>
                        f.type ===
                        "eq" &&
                        (
                            f.column ===
                            "property_id" ||
                            f.column ===
                            "id"
                        )
                );

            if (!propertyFilter) {

                return {
                    data: null,

                    error: {
                        message:
                            "Deleting a saved property requires a property_id or id filter."
                    }
                };
            }

            return apiRequest(
                `/saved-properties/${encodeURIComponent(propertyFilter.value)}`,
                {
                    method: "DELETE"
                }
            );
        }


        return {
            data: [],
            error: null
        };
    }


    // ========================================================
    // SHARED LIST FINISHERS
    // ========================================================

    finishRows(rows) {

        let out =
            Array.isArray(rows)
                ? rows.slice()
                : [];


        out =
            applyClientOrder(
                out,
                this.orderBy,
                this.orderAscending
            );


        if (
            this.offsetCount != null
        ) {

            out =
                out.slice(
                    this.offsetCount
                );
        }


        if (
            this.limitCount != null
        ) {

            out =
                out.slice(
                    0,
                    this.limitCount
                );
        }


        if (
            this.singleMode
        ) {

            if (
                out.length !== 1 &&
                !this.lenientSingle
            ) {

                return {
                    data: null,

                    error: {
                        message:
                            "Expected exactly one row"
                    }
                };
            }

            return {
                data:
                    out[0] ||
                    null,

                error: null
            };
        }


        if (
            this.maybeSingleMode
        ) {

            return {
                data:
                    out[0] ||
                    null,

                error: null
            };
        }


        return {
            data: out,
            error: null
        };
    }


    // Pair lookup used as
    // .or("and(participant_a.eq.A,participant_b.eq.B),and(...)").
    // Returns the two ids, or an empty array when absent.

    pairIdsFromOr() {

        const ids =
            new Set();

        for (
            const filter of
            this.filters
        ) {

            if (
                filter.type !== "or" ||
                !filter.expression
            ) {

                continue;
            }

            const matches =
                filter.expression.matchAll(
                    /participant_[ab]\.eq\.([0-9a-fA-F-]{36})/g
                );

            for (
                const match of
                matches
            ) {

                ids.add(
                    match[1]
                );
            }
        }

        return [...ids];
    }


    // Generic any-of matcher for flat expressions such as
    // "profile_id.eq.X,owner_id.eq.X".

    matchAnyOr(row) {

        const ors =
            this.filters.filter(
                f =>
                    f.type ===
                    "or" &&
                    f.expression &&
                    !f.expression.includes(
                        "and("
                    )
            );

        if (!ors.length) {

            return true;
        }

        return ors.every(
            filter => {

                const tokens = [
                    ...filter.expression.matchAll(
                        /([A-Za-z_][A-Za-z0-9_]*)\.eq\.([^,)]+)/g
                    )
                ];

                if (!tokens.length) {

                    return true;
                }

                return tokens.some(
                    token =>
                        String(
                            row[
                            token[1]
                            ] ??
                            ""
                        ) ===
                        String(
                            token[2]
                        )
                );
            }
        );
    }


    // ========================================================
    // CONVERSATIONS
    // ========================================================

    async executeConversations() {

        // ----------------------------------------------------
        // CREATE
        // ----------------------------------------------------

        if (
            this.operation ===
            "insert"
        ) {

            const payload =
                Array.isArray(
                    this.insertData
                )
                    ? this.insertData[0] || {}
                    : this.insertData || {};

            const result =
                await apiRequest(
                    "/conversations",
                    {
                        method: "POST",

                        body:
                            JSON.stringify({
                                participant_id:
                                    payload.participant_b ||
                                    payload.participant_a,

                                property_id:
                                    payload.property_id ||
                                    null
                            })
                    }
                );

            if (result.error) {

                return result;
            }

            const conversation =
                result.data
                    ?.conversation ||
                null;

            if (
                this.singleMode ||
                this.returnChangedRows
            ) {

                return {
                    data: conversation,
                    error: null
                };
            }

            return {
                data:
                    conversation
                        ? [conversation]
                        : [],

                error: null
            };
        }


        // ----------------------------------------------------
        // TOUCH (last_message_at is maintained server-side
        // on message insert, so this is a safe no-op)
        // ----------------------------------------------------

        if (
            this.operation ===
            "update"
        ) {

            return {
                data: [],
                error: null
            };
        }


        // ----------------------------------------------------
        // DELETE
        // ----------------------------------------------------

        if (
            this.operation ===
            "delete"
        ) {

            const idFilter =
                this.filters.find(
                    f =>
                        f.type ===
                        "eq" &&
                        f.column ===
                        "id"
                );

            if (!idFilter) {

                return {
                    data: null,

                    error: {
                        message:
                            "Deleting a conversation requires an id filter."
                    }
                };
            }

            const result =
                await apiRequest(
                    `/conversations/${encodeURIComponent(idFilter.value)}`,
                    {
                        method: "DELETE"
                    }
                );

            if (result.error) {

                return result;
            }

            return {
                data: [],
                error: null
            };
        }


        // ----------------------------------------------------
        // SELECT (pair lookup or own list)
        // ----------------------------------------------------

        const listResult =
            await apiRequest(
                "/conversations"
            );

        if (listResult.error) {

            return listResult;
        }

        let rows =
            listResult.data
                ?.conversations ||
            [];

        const pairIds =
            this.pairIdsFromOr();

        if (pairIds.length >= 2) {

            const [first, second] =
                pairIds;

            rows =
                rows.filter(
                    row =>
                        (
                            String(row.participant_one) ===
                                String(first) &&
                            String(row.participant_two) ===
                                String(second)
                        ) ||
                        (
                            String(row.participant_one) ===
                                String(second) &&
                            String(row.participant_two) ===
                                String(first)
                        )
                );
        }

        rows =
            applyClientFilters(
                rows,
                this.filters
            );

        this.lenientSingle =
            true;

        return this.finishRows(
            rows
        );
    }


    // ========================================================
    // MESSAGES
    // ========================================================

    async executeMessages() {

        // ----------------------------------------------------
        // SEND
        // ----------------------------------------------------

        if (
            this.operation ===
            "insert"
        ) {

            const payload =
                Array.isArray(
                    this.insertData
                )
                    ? this.insertData[0] || {}
                    : this.insertData || {};

            if (!payload.conversation_id) {

                return {
                    data: null,

                    error: {
                        message:
                            "Sending a message requires a conversation_id."
                    }
                };
            }

            const result =
                await apiRequest(
                    `/conversations/${encodeURIComponent(payload.conversation_id)}/messages`,
                    {
                        method: "POST",

                        body:
                            JSON.stringify({
                                body:
                                    payload.body ||
                                    payload.message ||
                                    ""
                            })
                    }
                );

            if (result.error) {

                return result;
            }

            const message =
                result.data
                    ?.message ||
                null;

            return {
                data:
                    message
                        ? [message]
                        : [],

                error: null
            };
        }


        // ----------------------------------------------------
        // MARK READ
        // ----------------------------------------------------

        if (
            this.operation ===
            "update"
        ) {

            const conversationFilter =
                this.filters.find(
                    f =>
                        f.type ===
                        "eq" &&
                        f.column ===
                        "conversation_id"
                );

            // Scoped mark-read maps to one PATCH call.

            if (conversationFilter) {

                const result =
                    await apiRequest(
                        `/conversations/${encodeURIComponent(conversationFilter.value)}/read`,
                        {
                            method: "PATCH"
                        }
                    );

                if (result.error) {

                    return result;
                }

                return {
                    data: [],
                    error: null
                };
            }


            // Unscoped mark-all-read: walk the conversation list.

            const listResult =
                await apiRequest(
                    "/conversations"
                );

            if (!listResult.error) {

                const conversations =
                    listResult.data
                        ?.conversations ||
                    [];

                for (
                    const conversation of
                    conversations
                ) {

                    await apiRequest(
                        `/conversations/${encodeURIComponent(conversation.id)}/read`,
                        {
                            method: "PATCH"
                        }
                    ).catch(
                        () => null
                    );
                }
            }

            return {
                data: [],
                error: null
            };
        }


        // ----------------------------------------------------
        // UNREAD BADGE COUNT
        // ----------------------------------------------------

        if (
            this.countMode
        ) {

            const listResult =
                await apiRequest(
                    "/conversations"
                );

            if (listResult.error) {

                return listResult;
            }

            const conversations =
                listResult.data
                    ?.conversations ||
                [];

            return {
                data: [],
                error: null,

                count:
                    conversations.reduce(
                        (total, conversation) =>
                            total +
                            (
                                Number(
                                    conversation.unread_count
                                ) ||
                                0
                            ),

                        0
                    )
            };
        }


        // ----------------------------------------------------
        // SELECT BY CONVERSATION
        // ----------------------------------------------------

        const conversationFilter =
            this.filters.find(
                f =>
                    f.type ===
                    "eq" &&
                    f.column ===
                    "conversation_id"
            );

        if (!conversationFilter) {

            return {
                data: [],
                error: null
            };
        }

        const result =
            await apiRequest(
                `/conversations/${encodeURIComponent(conversationFilter.value)}/messages`
            );

        if (result.error) {

            return result;
        }

        const rows =
            applyClientFilters(
                result.data
                    ?.messages ||
                [],
                this.filters
            );

        return this.finishRows(
            rows
        );
    }


    // ========================================================
    // MOVERS
    // ========================================================

    async executeMovers() {

        // ----------------------------------------------------
        // JOIN (create mover profile)
        // ----------------------------------------------------

        if (
            this.operation ===
            "insert"
        ) {

            const payload =
                Array.isArray(
                    this.insertData
                )
                    ? this.insertData[0] || {}
                    : this.insertData || {};

            const result =
                await apiRequest(
                    "/movers",
                    {
                        method: "POST",

                        body:
                            JSON.stringify({
                                company_name:
                                    payload.company_name,

                                description:
                                    payload.description ||
                                    null,

                                city:
                                    payload.city ||
                                    "Harare",

                                service_areas:
                                    payload.service_areas ||
                                    [],

                                vehicle_types:
                                    payload.vehicle_types ||
                                    [],

                                base_price_usd:
                                    payload.base_price_usd ||
                                    0,

                                price_per_km:
                                    payload.price_per_km ||
                                    0,

                                phone:
                                    payload.phone,

                                whatsapp:
                                    payload.whatsapp ||
                                    null,

                                email:
                                    payload.email ||
                                    null,

                                website:
                                    payload.website ||
                                    null,

                                currency:
                                    payload.currency ||
                                    "USD"
                            })
                    }
                );

            if (result.error) {

                return result;
            }

            const mover =
                result.data
                    ?.mover ||
                null;

            if (
                this.singleMode ||
                this.returnChangedRows
            ) {

                return {
                    data: mover,
                    error: null
                };
            }

            return {
                data:
                    mover
                        ? [mover]
                        : [],

                error: null
            };
        }


        // ----------------------------------------------------
        // SELECT
        // ----------------------------------------------------

        const result =
            await apiRequest(
                "/movers"
            );

        if (result.error) {

            return result;
        }

        let rows =
            result.data
                ?.movers ||
            [];

        rows =
            rows.filter(
                row =>
                    this.matchAnyOr(
                        row
                    )
            );

        rows =
            applyClientFilters(
                rows,
                this.filters
            );

        this.lenientSingle =
            true;

        return this.finishRows(
            rows
        );
    }


    // ========================================================
    // MOVER BOOKINGS
    // ========================================================

    async executeMoverBookings() {

        // ----------------------------------------------------
        // CREATE
        // ----------------------------------------------------

        if (
            this.operation ===
            "insert"
        ) {

            const payload =
                Array.isArray(
                    this.insertData
                )
                    ? this.insertData[0] || {}
                    : this.insertData || {};

            if (!payload.mover_id) {

                return {
                    data: null,

                    error: {
                        message:
                            "Booking a mover requires a mover_id."
                    }
                };
            }

            const result =
                await apiRequest(
                    `/movers/${encodeURIComponent(payload.mover_id)}/bookings`,
                    {
                        method: "POST",

                        body:
                            JSON.stringify({
                                moving_date:
                                    payload.moving_date ||
                                    null,

                                pickup_address:
                                    payload.pickup_address,

                                drop_address:
                                    payload.drop_address ||
                                    null,

                                pickup_city:
                                    payload.pickup_city ||
                                    null,

                                drop_city:
                                    payload.drop_city ||
                                    null,

                                distance_km:
                                    payload.distance_km ||
                                    null,

                                items_description:
                                    payload.items_description ||
                                    null,

                                notes:
                                    payload.notes ||
                                    null
                            })
                    }
                );

            if (result.error) {

                return result;
            }

            const booking =
                result.data
                    ?.booking ||
                null;

            return {
                data:
                    booking
                        ? [booking]
                        : [],

                error: null
            };
        }


        // ----------------------------------------------------
        // SELECT (own bookings, mover joined in)
        // ----------------------------------------------------

        const result =
            await apiRequest(
                "/movers/bookings/me"
            );

        if (result.error) {

            return result;
        }

        let rows =
            result.data
                ?.bookings ||
            [];

        try {

            const moversResult =
                await apiRequest(
                    "/movers"
                );

            if (!moversResult.error) {

                const byId =
                    new Map(
                        (
                            moversResult.data
                                ?.movers ||
                            []
                        ).map(
                            mover => [
                                mover.id,
                                mover
                            ]
                        )
                    );

                rows =
                    rows.map(
                        row => ({
                            ...row,

                            movers:
                                row.mover_id &&
                                byId.get(
                                    row.mover_id
                                )
                                    ? {
                                        company_name:
                                            byId.get(
                                                row.mover_id
                                            ).company_name
                                    }
                                    : row.movers ||
                                    null
                        })
                    );
            }
        } catch {
            // Join is best-effort; bookings still render.
        }

        rows =
            applyClientFilters(
                rows,
                this.filters
            );

        return this.finishRows(
            rows
        );
    }


    // ========================================================
    // NOTIFICATIONS
    // ========================================================

    async executeNotifications() {

        // ----------------------------------------------------
        // CREATE
        // ----------------------------------------------------

        if (
            this.operation ===
            "insert"
        ) {

            const result =
                await apiRequest(
                    "/notifications",
                    {
                        method: "POST",

                        body:
                            JSON.stringify(
                                this.insertData
                            )
                    }
                );

            if (result.error) {

                return result;
            }

            const created =
                result.data
                    ?.created ||
                [];

            return {
                data:
                    created.map(
                        id => ({ id })
                    ),

                error: null
            };
        }


        // ----------------------------------------------------
        // SELECT
        // ----------------------------------------------------

        const result =
            await apiRequest(
                "/notifications/me"
            );

        if (result.error) {

            return result;
        }

        const rows =
            applyClientFilters(
                result.data
                    ?.notifications ||
                [],
                this.filters
            );

        return this.finishRows(
            rows
        );
    }


    // ========================================================
    // REVIEWS
    // ========================================================

    async executeReviews() {

        const params =
            new URLSearchParams();

        const propertyFilter =
            this.filters.find(
                f =>
                    f.type ===
                    "eq" &&
                    f.column ===
                    "property_id"
            );

        const moverFilter =
            this.filters.find(
                f =>
                    f.type ===
                    "eq" &&
                    f.column ===
                    "mover_id"
            );

        if (propertyFilter) {

            params.set(
                "property_id",
                String(
                    propertyFilter.value
                )
            );
        }

        if (moverFilter) {

            params.set(
                "mover_id",
                String(
                    moverFilter.value
                )
            );
        }

        const query =
            params.toString()
                ? `?${params.toString()}`
                : "";

        const result =
            await apiRequest(
                `/reviews${query}`
            );

        if (result.error) {

            return result;
        }

        const rows =
            applyClientFilters(
                result.data
                    ?.reviews ||
                [],
                this.filters
            );

        return this.finishRows(
            rows
        );
    }


    // ========================================================
    // CONTACT SUBMISSIONS
    // ========================================================

    async executeContactSubmissions() {

        if (
            this.operation !==
            "insert"
        ) {

            return {
                data: [],
                error: null
            };
        }

        const payload =
            Array.isArray(
                this.insertData
            )
                ? this.insertData[0] || {}
                : this.insertData || {};

        const result =
            await apiRequest(
                "/contact-submissions",
                {
                    method: "POST",

                    body:
                        JSON.stringify({
                            name:
                                payload.name,

                            email:
                                payload.email,

                            subject:
                                payload.subject ||
                                null,

                            message:
                                payload.message
                        })
                }
            );

        if (result.error) {

            return result;
        }

        const submission =
            result.data
                ?.submission ||
            null;

        return {
            data:
                submission
                    ? [submission]
                    : [],

            error: null
        };
    }


    // ========================================================
    // THENABLE QUERY BUILDER
    // ========================================================

    then(
        resolve,
        reject
    ) {

        return this
            .execute()
            .then(
                resolve,
                reject
            );
    }
}


// ============================================================
// DATA MAPPERS
// ============================================================

function mapProperty(p) {

    if (!p) {
        return p;
    }

    let images = [];


    if (
        Array.isArray(
            p.images
        )
    ) {

        images =
            p.images;

    } else if (
        typeof p.images ===
        "string"
    ) {

        try {

            images =
                JSON.parse(
                    p.images
                );

        } catch {

            images = [];
        }
    }


    if (
        !Array.isArray(images)
    ) {

        images = [];
    }


    const propertyImages =
        images.map(
            item => {

                if (
                    typeof item ===
                    "string"
                ) {

                    return {
                        url: item,
                        alt_text: "",
                        is_cover: false
                    };
                }

                return {

                    url:
                        item?.url ||
                        item?.src ||
                        "",

                    alt_text:
                        item?.alt_text ||
                        item?.alt ||
                        "",

                    is_cover:
                        Boolean(
                            item?.is_cover ||
                            item?.isCover ||
                            false
                        )
                };
            }
        );


    const rentPrice =
        p.listing_type ===
            "rent"

            ? Number(
                p.price || 0
            )

            : null;


    const salePrice =
        p.listing_type ===
            "sale"

            ? Number(
                p.price || 0
            )

            : null;


    return {

        ...p,


        rent_usd:
            rentPrice,


        sale_price_usd:
            salePrice,


        property_images:
            propertyImages,


        owner_name:
            p.owner_name ||
            p.owner?.full_name ||
            "Local Agent",


        owner_phone:
            p.owner_phone ||
            p.owner?.phone ||
            "",


        suburb:
            p.suburb ||
            "",


        area_sqm:
            p.area_sqm ||
            null,


        parking_spots:
            p.parking_spots ||
            0,


        listing_purpose:
            p.listing_purpose ||
            (
                p.listing_type ===
                    "sale"

                    ? "sale"

                    : "rent"
            ),


        views:
            p.views ||
            0,


        rating:
            Number(
                p.rating || 0
            )
    };
}


function mapApplication(a) {

    if (!a) {
        return a;
    }

    return {

        ...a,

        properties: {

            id:
                a.property_id,

            title:
                a.property_title,

            price:
                a.price,

            currency:
                a.currency,

            address:
                a.address,

            city:
                a.city,

            country:
                a.country
        }
    };
}


function mapProfile(p) {

    if (!p) {
        return null;
    }

    const fullName =
        p.full_name ||
        p.name ||
        "";

    const parts =
        fullName
            .trim()
            .split(/\s+/)
            .filter(Boolean);


    return {

        ...p,


        first_name:
            p.first_name ||
            parts[0] ||
            "",


        last_name:
            p.last_name ||
            parts
                .slice(1)
                .join(" ") ||
            "",


        phone_number:
            p.phone_number ||
            p.phone ||
            "",


        role:
            p.role ||
            "tenant"
    };
}


// ============================================================
// CLIENT-SIDE FILTER HELPERS
// ============================================================

function applyClientFilters(
    rows,
    filters
) {

    if (
        !Array.isArray(rows)
    ) {

        return [];
    }

    if (
        !Array.isArray(filters)
    ) {

        return rows;
    }


    return rows.filter(
        row => {

            return filters.every(
                filter => {

                    if (
                        !filter.column
                    ) {

                        return true;
                    }


                    const value =
                        row[
                        filter.column
                        ];


                    switch (
                    filter.type
                    ) {

                        // ------------------------------------
                        // EQ
                        // ------------------------------------

                        case "eq":

                            return String(
                                value
                            ) ===
                                String(
                                    filter.value
                                );


                        // ------------------------------------
                        // NEQ
                        // ------------------------------------

                        case "neq":

                            return String(
                                value
                            ) !==
                                String(
                                    filter.value
                                );


                        // ------------------------------------
                        // IN
                        // ------------------------------------

                        case "in":

                            return (
                                Array.isArray(
                                    filter.values
                                )
                                &&
                                filter.values.some(
                                    item =>
                                        String(
                                            value
                                        ) ===
                                        String(
                                            item
                                        )
                                )
                            );


                        // ------------------------------------
                        // NOT IN
                        // ------------------------------------

                        case "notIn":

                            return !(
                                Array.isArray(
                                    filter.values
                                )
                                &&
                                filter.values.some(
                                    item =>
                                        String(
                                            value
                                        ) ===
                                        String(
                                            item
                                        )
                                )
                            );


                        // ------------------------------------
                        // GT
                        // ------------------------------------

                        case "gt":

                            return value >
                                filter.value;


                        // ------------------------------------
                        // GTE
                        // ------------------------------------

                        case "gte":

                            return value >=
                                filter.value;


                        // ------------------------------------
                        // LT
                        // ------------------------------------

                        case "lt":

                            return value <
                                filter.value;


                        // ------------------------------------
                        // LTE
                        // ------------------------------------

                        case "lte":

                            return value <=
                                filter.value;


                        // ------------------------------------
                        // LIKE
                        // ------------------------------------

                        case "like":

                            return matchLike(
                                value,
                                filter.value,
                                false
                            );


                        // ------------------------------------
                        // ILIKE
                        // ------------------------------------

                        case "ilike":

                            return matchLike(
                                value,
                                filter.value,
                                true
                            );


                        // ------------------------------------
                        // IS
                        // ------------------------------------

                        case "is":

                            if (
                                filter.value ===
                                null
                            ) {

                                return value ===
                                    null;
                            }

                            if (
                                filter.value ===
                                "null"
                            ) {

                                return value ===
                                    null;
                            }

                            if (
                                filter.value ===
                                "true"
                            ) {

                                return value ===
                                    true;
                            }

                            if (
                                filter.value ===
                                "false"
                            ) {

                                return value ===
                                    false;
                            }

                            return String(
                                value
                            ) ===
                                String(
                                    filter.value
                                );


                        // ------------------------------------
                        // NOT
                        // ------------------------------------

                        case "not":

                            return applyNotFilter(
                                value,
                                filter.operator,
                                filter.value
                            );


                        // ------------------------------------
                        // OR
                        // ------------------------------------

                        case "or":

                            return evaluateOrExpression(
                                row,
                                filter.expression
                            );


                        default:

                            return true;
                    }
                }
            );
        }
    );
}


// ============================================================
// LIKE / ILIKE
// ============================================================

function matchLike(
    value,
    pattern,
    caseInsensitive = false
) {

    if (
        value == null
    ) {

        return false;
    }

    let text =
        String(value);

    let search =
        String(pattern);


    if (
        caseInsensitive
    ) {

        text =
            text.toLowerCase();

        search =
            search.toLowerCase();
    }


    // Convert SQL LIKE % / _
    // into a regular expression.

    const regex =
        "^" +
        search
            .replace(
                /[.*+?^${}()|[\]\\]/g,
                "\\$&"
            )
            .replace(
                /%/g,
                ".*"
            )
            .replace(
                /_/g,
                "."
            ) +
        "$";


    try {

        return new RegExp(
            regex
        ).test(text);

    } catch {

        return false;
    }
}


// ============================================================
// NOT FILTER
// ============================================================

function applyNotFilter(
    value,
    operator,
    expected
) {

    switch (
    operator
    ) {

        case "eq":

            return String(
                value
            ) !==
                String(
                    expected
                );


        case "neq":

            return String(
                value
            ) ===
                String(
                    expected
                );


        case "in":

            return !(
                Array.isArray(
                    expected
                ) &&
                expected.some(
                    item =>
                        String(
                            value
                        ) ===
                        String(
                            item
                        )
                )
            );


        case "is":

            return value !==
                expected;


        default:

            return true;
    }
}


// ============================================================
// OR EXPRESSION
// ============================================================

function evaluateOrExpression(
    row,
    expression
) {

    if (
        !expression ||
        typeof expression !==
        "string"
    ) {

        return true;
    }


    // Supports common Supabase-style:
    //
    // "role.eq.agent,role.eq.landlord"
    //
    // "status.eq.active,status.eq.pending"

    const parts =
        expression
            .split(",")
            .map(
                part =>
                    part.trim()
            )
            .filter(Boolean);


    return parts.some(
        condition => {

            const pieces =
                condition.split(
                    "."
                );

            if (
                pieces.length <
                3
            ) {

                return false;
            }

            const column =
                pieces[0];

            const operator =
                pieces[1];

            const expected =
                pieces
                    .slice(2)
                    .join(".");


            const value =
                row[column];


            switch (
            operator
            ) {

                case "eq":

                    return String(
                        value
                    ) ===
                        String(
                            expected
                        );


                case "neq":

                    return String(
                        value
                    ) !==
                        String(
                            expected
                        );


                case "gt":

                    return value >
                        expected;


                case "gte":

                    return value >=
                        expected;


                case "lt":

                    return value <
                        expected;


                case "lte":

                    return value <=
                        expected;


                case "ilike":

                    return matchLike(
                        value,
                        expected,
                        true
                    );


                case "like":

                    return matchLike(
                        value,
                        expected,
                        false
                    );


                default:

                    return false;
            }
        }
    );
}


// ============================================================
// CLIENT-SIDE ORDER
// ============================================================

function applyClientOrder(
    rows,
    column,
    ascending
) {

    if (
        !column ||
        !Array.isArray(rows)
    ) {

        return rows;
    }


    return [
        ...rows
    ].sort(
        (a, b) => {

            const av =
                a[column];

            const bv =
                b[column];


            if (
                av == null &&
                bv == null
            ) {

                return 0;
            }


            if (
                av == null
            ) {

                return 1;
            }


            if (
                bv == null
            ) {

                return -1;
            }


            if (
                av < bv
            ) {

                return ascending
                    ? -1
                    : 1;
            }


            if (
                av > bv
            ) {

                return ascending
                    ? 1
                    : -1;
            }


            return 0;
        }
    );
}


// ============================================================
// CHANNEL / REALTIME COMPATIBILITY
// ============================================================

function createChannel(
    name
) {

    const channel = {

        name,

        on(
            event,
            filter,
            callback
        ) {

            // Compatibility only.
            // PostgreSQL LISTEN/NOTIFY
            // can be added later.

            return channel;
        },


        subscribe(
            callback
        ) {

            if (
                typeof callback ===
                "function"
            ) {

                setTimeout(
                    () =>
                        callback(
                            "SUBSCRIBED"
                        ),
                    0
                );
            }

            return channel;
        },


        unsubscribe() {

            return Promise.resolve();
        }
    };


    return channel;
}


// ============================================================
// MAIN CLIENT
// ============================================================

const HlalaClient = {

    auth:
        HlalaAuth,


    from(table) {

        return new QueryBuilder(
            table
        );
    },


    channel(name) {

        return createChannel(
            name
        );
    },


    removeChannel(
        channel
    ) {

        if (
            channel &&
            typeof channel.unsubscribe ===
            "function"
        ) {

            return channel.unsubscribe();
        }

        return Promise.resolve();
    },


    // ========================================================
    // RPC
    // ========================================================

    async rpc(
        functionName,
        params = {}
    ) {

        const result =
            await apiRequest(
                `/rpc/${encodeURIComponent(functionName)}`,
                {
                    method: "POST",

                    body:
                        JSON.stringify(
                            params
                        )
                }
            );

        return result;
    },


    // ========================================================
    // STORAGE
    // ========================================================

    storage: {

        from(bucket) {

            return {

                async upload(
                    path,
                    file,
                    options = {}
                ) {

                    try {

                        const formData =
                            new FormData();

                        formData.append(
                            "file",
                            file
                        );

                        formData.append(
                            "path",
                            path
                        );

                        formData.append(
                            "bucket",
                            bucket
                        );


                        const headers = {};

                        const token =
                            getToken();

                        if (token) {

                            headers.Authorization =
                                `Bearer ${token}`;
                        }


                        const response =
                            await fetch(
                                `${HLALA_API_URL}/storage/upload`,
                                {
                                    method:
                                        "POST",

                                    headers,

                                    body:
                                        formData
                                }
                            );


                        const data =
                            await response
                                .json();


                        if (
                            !response.ok
                        ) {

                            return {

                                data: null,

                                error: {

                                    message:
                                        data.message ||
                                        "File upload failed.",

                                    status:
                                        response.status
                                }
                            };
                        }


                        return {

                            data,

                            error: null
                        };

                    } catch (
                    error
                    ) {

                        return {

                            data: null,

                            error: {

                                message:
                                    "Could not upload file.",

                                original:
                                    error
                            }
                        };
                    }
                },


                getPublicUrl(
                    path
                ) {

                    return {

                        data: {

                            publicUrl:
                                `${HLALA_API_URL}/storage/${encodeURIComponent(bucket)}/${encodeURIComponent(path)}`
                        }
                    };
                }
            };
        }
    }
};


// ============================================================
// SUPABASE-COMPATIBLE GLOBAL
// ============================================================

window.supabase = {

    createClient() {

        return HlalaClient;
    }
};


// ============================================================
// sb() HELPER
// ============================================================

window.sb =
    function () {

        return HlalaClient;
    };


// ============================================================
// LEGACY GLOBAL
// ============================================================

window.__hlalaPostgres = {

    apiUrl:
        HLALA_API_URL,

    client:
        HlalaClient,

    getToken,

    getStoredUser,

    clearSession
};


// ============================================================
// DEBUG INFORMATION
// ============================================================

console.log(
    "[Hlala Link] PostgreSQL backend adapter loaded."
);

console.log(
    "[Hlala Link] Supabase compatibility: .eq(), .neq(), .in(), .notIn(), .gt(), .gte(), .lt(), .lte(), .like(), .ilike(), .is(), .not(), .or(), .order(), .limit(), .range(), .single(), .maybeSingle()"
);