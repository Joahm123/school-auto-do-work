const state = {
    user: null,
    assignments: [],
    courses: []
};

const pages = {
    dashboard: document.getElementById("dashboardPage"),
    assignments: document.getElementById("assignmentsPage"),
    helper: document.getElementById("helperPage"),
    settings: document.getElementById("settingsPage")
};

function showPage(name) {
    Object.values(pages).forEach(page => {
        page.classList.remove("active-page");
    });

    if (pages[name]) {
        pages[name].classList.add("active-page");
    }

    document.querySelectorAll(".nav-button").forEach(button => {
        button.classList.toggle(
            "active",
            button.dataset.page === name
        );
    });
}

document.querySelectorAll(".nav-button").forEach(button => {
    button.addEventListener("click", () => {
        showPage(button.dataset.page);
    });
});

document.querySelectorAll("[data-page-target]").forEach(button => {
    button.addEventListener("click", () => {
        showPage(button.dataset.pageTarget);
    });
});

function toast(message) {
    const element = document.getElementById("toast");

    element.textContent = message;
    element.classList.add("show");

    setTimeout(() => {
        element.classList.remove("show");
    }, 3000);
}

function connectGoogle() {
    window.location.href = "/auth/google";
}

document.getElementById("loginButton").addEventListener("click", connectGoogle);
document.getElementById("connectButton").addEventListener("click", connectGoogle);
document.getElementById("settingsLogin").addEventListener("click", connectGoogle);

async function loadUser() {
    try {
        const response = await fetch("/api/me");

        if (!response.ok) {
            return;
        }

        const data = await response.json();

        state.user = data.user;

        if (state.user) {
            document.getElementById("accountName").textContent =
                state.user.name || state.user.email || "Connected";

            document.getElementById("loginButton").textContent = "Connected";
            document.getElementById("googleStatus").textContent =
                state.user.email || "Connected";

            await loadAssignments();
        }
    } catch {
        console.log("Not authenticated.");
    }
}

async function loadAssignments() {
    try {
        const response = await fetch("/api/classroom/assignments");

        if (!response.ok) {
            throw new Error("Unable to load assignments.");
        }

        const data = await response.json();

        state.assignments = data.assignments || [];
        state.courses = data.courses || [];

        renderStats();
        renderRecentAssignments();
        renderAssignments();
    } catch (error) {
        console.error(error);
        toast("Could not load Classroom assignments.");
    }
}

function renderStats() {
    document.getElementById("assignmentCount").textContent =
        state.assignments.length;

    document.getElementById("courseCount").textContent =
        state.courses.length;

    const now = Date.now();
    const nextWeek = now + 7 * 24 * 60 * 60 * 1000;

    const dueSoon = state.assignments.filter(assignment => {
        if (!assignment.due) {
            return false;
        }

        const due = new Date(assignment.due).getTime();

        return due >= now && due <= nextWeek;
    });

    document.getElementById("dueCount").textContent = dueSoon.length;
}

function createAssignmentCard(assignment) {
    const card = document.createElement("div");
    card.className = "assignment-card";

    const course = document.createElement("div");
    course.className = "assignment-course";
    course.textContent = assignment.courseName || "Classroom";

    const title = document.createElement("div");
    title.className = "assignment-title";
    title.textContent = assignment.title || "Untitled assignment";

    const due = document.createElement("div");
    due.className = "assignment-due";

    if (assignment.due) {
        due.textContent = `Due ${formatDate(assignment.due)}`;
    } else {
        due.textContent = "No due date";
    }

    card.append(course, title, due);

    return card;
}

function renderRecentAssignments() {
    const container = document.getElementById("recentAssignments");

    container.innerHTML = "";

    const recent = state.assignments.slice(0, 6);

    if (!recent.length) {
        container.innerHTML = `
            <div class="empty-card">
                <h3>No assignments found</h3>
                <p>Your Classroom account is connected, but there are no assignments to display.</p>
            </div>
        `;
        return;
    }

    recent.forEach(assignment => {
        container.appendChild(createAssignmentCard(assignment));
    });
}

function renderAssignments() {
    const container = document.getElementById("assignmentList");

    container.innerHTML = "";

    if (!state.assignments.length) {
        container.innerHTML = `
            <div class="empty-card">
                <h3>No assignments found</h3>
                <p>There are currently no assignments available.</p>
            </div>
        `;

        return;
    }

    state.assignments.forEach(assignment => {
        const row = document.createElement("div");
        row.className = "assignment-row";

        row.innerHTML = `
            <div>
                <div class="assignment-row-title"></div>
                <div class="assignment-row-course"></div>
            </div>
            <div class="assignment-row-due"></div>
        `;

        row.querySelector(".assignment-row-title").textContent =
            assignment.title || "Untitled assignment";

        row.querySelector(".assignment-row-course").textContent =
            assignment.courseName || "Classroom";

        row.querySelector(".assignment-row-due").textContent =
            assignment.due
                ? `Due ${formatDate(assignment.due)}`
                : "No due date";

        container.appendChild(row);
    });
}

function formatDate(date) {
    return new Date(date).toLocaleString([], {
        month: "short",
        day: "numeric",
        year: "numeric"
    });
}

document
    .getElementById("refreshAssignments")
    .addEventListener("click", async () => {
        const button = document.getElementById("refreshAssignments");

        button.disabled = true;
        button.textContent = "Refreshing...";

        await loadAssignments();

        button.disabled = false;
        button.textContent = "Refresh";
    });

document
    .getElementById("explainButton")
    .addEventListener("click", async () => {
        const question = document
            .getElementById("questionInput")
            .value
            .trim();

        const subject = document.getElementById("subjectSelect").value;
        const output = document.getElementById("helperOutput");
        const status = document.getElementById("helperStatus");

        if (!question) {
            toast("Enter a question first.");
            return;
        }

        status.textContent = "Thinking...";
        output.textContent = "";

        try {
            const response = await fetch("/api/helper", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    question,
                    subject
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || "Helper failed.");
            }

            output.textContent = data.answer;
            status.textContent = "Ready";
        } catch (error) {
            output.textContent = error.message;
            status.textContent = "Error";
        }
    });

loadUser();
