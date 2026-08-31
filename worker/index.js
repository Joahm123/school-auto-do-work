const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CLASSROOM_API = "https://classroom.googleapis.com/v1";

const GOOGLE_SCOPES = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/classroom.courses.readonly",
    "https://www.googleapis.com/auth/classroom.coursework.me.readonly"
];

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (url.pathname === "/auth/google") {
            return googleLogin(env, url);
        }

        if (url.pathname === "/auth/google/callback") {
            return googleCallback(request, env, url);
        }

        if (url.pathname === "/api/me") {
            return apiMe(request, env);
        }

        if (url.pathname === "/api/classroom/assignments") {
            return classroomAssignments(request, env);
        }

        if (url.pathname === "/api/helper" && request.method === "POST") {
            return homeworkHelper(request, env);
        }

        return env.ASSETS.fetch(request);
    }
};

function googleLogin(env, url) {
    const redirectUri =
        `${url.origin}/auth/google/callback`;

    const params = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: GOOGLE_SCOPES.join(" "),
        access_type: "offline",
        prompt: "consent"
    });

    return Response.redirect(
        `${GOOGLE_AUTH_URL}?${params.toString()}`,
        302
    );
}

async function googleCallback(request, env, url) {
    const code = url.searchParams.get("code");

    if (!code) {
        return new Response("Missing authorization code.", {
            status: 400
        });
    }

    const redirectUri =
        `${url.origin}/auth/google/callback`;

    const response = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
            client_id: env.GOOGLE_CLIENT_ID,
            client_secret: env.GOOGLE_CLIENT_SECRET,
            code,
            grant_type: "authorization_code",
            redirect_uri: redirectUri
        })
    });

    if (!response.ok) {
        return new Response("Google authentication failed.", {
            status: 500
        });
    }

    const tokens = await response.json();

    const sessionId = crypto.randomUUID();

    await env.SESSIONS.put(
        sessionId,
        JSON.stringify(tokens),
        {
            expirationTtl: 60 * 60 * 24 * 7
        }
    );

    return new Response(null, {
        status: 302,
        headers: {
            Location: "/?connected=true",
            "Set-Cookie":
                `session=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`
        }
    });
}

function getSessionId(request) {
    const cookie = request.headers.get("Cookie");

    if (!cookie) {
        return null;
    }

    const match = cookie.match(/(?:^|;\s*)session=([^;]+)/);

    return match ? match[1] : null;
}

async function getTokens(request, env) {
    const sessionId = getSessionId(request);

    if (!sessionId) {
        return null;
    }

    const value = await env.SESSIONS.get(sessionId);

    if (!value) {
        return null;
    }

    return JSON.parse(value);
}

async function apiMe(request, env) {
    const tokens = await getTokens(request, env);

    if (!tokens) {
        return Response.json({
            user: null
        });
    }

    const response = await fetch(
        "https://openidconnect.googleapis.com/v1/userinfo",
        {
            headers: {
                Authorization: `Bearer ${tokens.access_token}`
            }
        }
    );

    if (!response.ok) {
        return Response.json({
            user: null
        });
    }

    const user = await response.json();

    return Response.json({
        user: {
            name: user.name,
            email: user.email,
            picture: user.picture
        }
    });
}

async function classroomAssignments(request, env) {
    const tokens = await getTokens(request, env);

    if (!tokens) {
        return Response.json(
            {
                error: "Not authenticated."
            },
            {
                status: 401
            }
        );
    }

    const headers = {
        Authorization: `Bearer ${tokens.access_token}`
    };

    const coursesResponse = await fetch(
        `${CLASSROOM_API}/courses?courseStates=ACTIVE&pageSize=100`,
        {
            headers
        }
    );

    if (!coursesResponse.ok) {
        return Response.json(
            {
                error: "Could not access Google Classroom."
            },
            {
                status: 502
            }
        );
    }

    const coursesData = await coursesResponse.json();
    const courses = coursesData.courses || [];

    const assignments = [];

    for (const course of courses) {
        const response = await fetch(
            `${CLASSROOM_API}/courses/${course.id}/courseWork?courseWorkStates=PUBLISHED&pageSize=100`,
            {
                headers
            }
        );

        if (!response.ok) {
            continue;
        }

        const data = await response.json();

        for (const work of data.courseWork || []) {
            let due = null;

            if (work.dueDate) {
                const year = work.dueDate.year;
                const month = String(work.dueDate.month).padStart(2, "0");
                const day = String(work.dueDate.day).padStart(2, "0");

                due = `${year}-${month}-${day}`;

                if (work.dueTime) {
                    const hour = String(
                        work.dueTime.hours || 0
                    ).padStart(2, "0");

                    const minute = String(
                        work.dueTime.minutes || 0
                    ).padStart(2, "0");

                    due += `T${hour}:${minute}:00`;
                }
            }

            assignments.push({
                id: work.id,
                courseId: course.id,
                courseName: course.name,
                title: work.title,
                description: work.description || "",
                due,
                state: work.state,
                materials: work.materials || []
            });
        }
    }

    assignments.sort((a, b) => {
        if (!a.due) return 1;
        if (!b.due) return -1;

        return new Date(a.due) - new Date(b.due);
    });

    return Response.json({
        courses,
        assignments
    });
}

async function homeworkHelper(request, env) {
    let body;

    try {
        body = await request.json();
    } catch {
        return Response.json(
            {
                error: "Invalid request."
            },
            {
                status: 400
            }
        );
    }

    const question = String(body.question || "").trim();
    const subject = String(body.subject || "general");

    if (!question) {
        return Response.json(
            {
                error: "Question is required."
            },
            {
                status: 400
            }
        );
    }

    if (!env.AI_API_KEY) {
        return Response.json({
            answer:
                "The helper is connected, but no AI API key has been configured yet. Add AI_API_KEY as a Cloudflare secret."
        });
    }

    const prompt = `
You are a homework study assistant.

Subject: ${subject}

Help the student understand the following question:

${question}

Give a clear explanation of the concepts and show the reasoning needed to solve it.
For math, show the relevant steps.
Do not claim to have submitted or completed anything.
Do not interact with external school websites.
`;

    const response = await fetch(
        "https://api.openai.com/v1/responses",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${env.AI_API_KEY}`
            },
            body: JSON.stringify({
                model: env.AI_MODEL || "gpt-5.6-mini",
                input: prompt
            })
        }
    );

    if (!response.ok) {
        return Response.json(
            {
                error: "AI request failed."
            },
            {
                status: 502
            }
        );
    }

    const data = await response.json();

    let answer = "";

    if (data.output_text) {
        answer = data.output_text;
    } else if (Array.isArray(data.output)) {
        for (const item of data.output) {
            if (!Array.isArray(item.content)) {
                continue;
            }

            for (const content of item.content) {
                if (content.text) {
                    answer += content.text;
                }
            }
        }
    }

    return Response.json({
        answer: answer || "No explanation was returned."
    });
}
