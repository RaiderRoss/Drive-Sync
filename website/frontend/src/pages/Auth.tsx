import { useLocation, useNavigate } from "react-router-dom";
import { Card, Form, Input, Button, Typography, Divider, Space } from "antd";
import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { PasswordStrength } from "../Components/passwordStrength";
import { EyeInvisibleOutlined, EyeTwoTone } from "@ant-design/icons";

const { Title, Text } = Typography;

export default function Auth() {
    const location = useLocation();
    const navigate = useNavigate();
    const { login, register } = useAuth();

    const isLoginRoute = location.pathname === "/login";

    const [mode, setMode] = useState<"login" | "register">(
        isLoginRoute ? "login" : "register"
    );

    const [loginError, setLoginError] = useState<string | null>(null);
    const [registerError, setRegisterError] = useState<string | null>(null);
    const [registerForm] = Form.useForm();
    const passwordValue = Form.useWatch("password", registerForm) || "";

    const strengthChecks = {
        has8Characters: passwordValue.length >= 8,
        hasLowercase: /[a-z]/.test(passwordValue),
        hasUppercase: /[A-Z]/.test(passwordValue),
        hasNumber: /\d/.test(passwordValue),
        hasSpecial: /[^A-Za-z0-9]/.test(passwordValue),
    };

    const strengthValue = [
        strengthChecks.has8Characters,
        strengthChecks.hasLowercase,
        strengthChecks.hasUppercase,
        strengthChecks.hasNumber,
        strengthChecks.hasSpecial,
    ].filter(Boolean).length * 20;

    useEffect(() => {
        setMode(isLoginRoute ? "login" : "register");
    }, [isLoginRoute]);

    const handleLogin = async (values: { username: string; password: string }) => {
        try {
            setLoginError(null);
            await login(values.username, values.password);
        } catch (error) {
            setLoginError(error instanceof Error ? error.message : "Login failed");
        }
    };

    const handleRegister = async (values: { username: string; password: string }) => {
        try {
            setRegisterError(null);
            await register(values.username, values.password);
        } catch (error: any) {
            if (error?.status === 409) {
                setRegisterError("An account with this username already exists");
            } else {
                setRegisterError(error instanceof Error ? error.message : "Registration failed");
            }
        }
    };

    return (
        <div
            style={{
                height: "100vh",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                padding: 24,
                background: "linear-gradient(135deg, #1c1c1c 0%, #1a2030 45%, #202731 100%)",
            }}
        >
            <div style={{ width: 420, maxWidth: "100%", overflow: "hidden" }}>
                <div
                    style={{
                        display: "flex",
                        width: "200%",
                        transform:
                            mode === "login" ? "translateX(0%)" : "translateX(-50%)",
                        transition: "transform 0.45s cubic-bezier(0.22, 1, 0.36, 1)",
                    }}
                >

                    <Card
                        style={{
                            width: "50%",
                            borderRadius: 24,
                            display: "flex",
                            flexDirection: "column",
                            minHeight: 520,
                            backdropFilter: "blur(12px)",
                        }}
                        styles={{ body: { padding: 28, height: "100%", display: "flex", flexDirection: "column" } }}
                    >
                        <Space direction="vertical" size={8} style={{ width: "100%", marginBottom: 20 }}>
                            <Typography.Text style={{ color: "#8c8c8c", letterSpacing: 1.4, textTransform: "uppercase", fontSize: 12 }}>
                                Welcome back
                            </Typography.Text>
                            <Title level={3} style={{ color: "white", margin: 0 }}>
                                Login
                            </Title>
                            <Typography.Text style={{ color: "#9aa4b2" }}>
                                Continue to your workspace.
                            </Typography.Text>
                        </Space>

                        <Divider style={{ borderColor: "rgba(255,255,255,0.08)", margin: "12px 0 20px" }} />

                        <Form layout="vertical" style={{ flex: 1, display: "flex", flexDirection: "column" }} onFinish={handleLogin}>
                            <Form.Item
                                name="username"
                                label={<span style={{ color: "#ccc" }}>Username</span>}
                                rules={[{ required: true, message: "Enter your username" }]}
                            >
                                <Input autoComplete="username" />
                            </Form.Item>

                            <Form.Item
                                name="password"
                                label={<span style={{ color: "#ccc" }}>Password</span>}
                                rules={[{ required: true, message: "Enter your password" }]}
                                style={{ marginBottom: 16 }}
                            >
                                <Input.Password autoComplete="current-password" iconRender={(visible) =>
                                    visible ? (
                                        <EyeTwoTone twoToneColor="#fff" />
                                    ) : (
                                        <EyeInvisibleOutlined style={{ color: "#fff" }} />
                                    )
                                } />
                            </Form.Item>

                            <Button type="primary" block htmlType="submit" style={{ marginBottom: 12 }}>
                                Login
                            </Button>
                            {loginError && (
                                <div
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 10,
                                        background: "#2e1e1e",
                                        border: "1px solid #c4453f",
                                        borderRadius: 6,
                                        padding: "10px 12px",
                                        color: "#f87171",
                                        fontSize: 13,
                                        marginBottom: 60,
                                    }}
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <circle cx="12" cy="12" r="10" />
                                        <path d="M15 9l-6 6M9 9l6 6" />
                                    </svg>
                                    <span>{loginError}</span>
                                </div>
                            )}
                        </Form>

                        <div style={{ position: "absolute", bottom: 18, left: 0, right: 0, textAlign: "center" }}>
                            <span style={{ color: "#8c8c8c" }}>No account?</span>{" "}
                            <Button
                                type="link"
                                onClick={() => {
                                    setMode("register");
                                    navigate("/register");
                                }}
                                style={{ marginLeft: 8 }}
                            >
                                Sign up
                            </Button>
                        </div>
                    </Card>

                    <Card
                        style={{
                            width: "50%",
                            borderRadius: 24,
                            display: "flex",
                            flexDirection: "column",
                            minHeight: 680,
                            backdropFilter: "blur(12px)",
                        }}
                        styles={{ body: { padding: 28, height: "100%", display: "flex", flexDirection: "column" } }}
                    >
                        <Space direction="vertical" size={8} style={{ width: "100%", marginBottom: 20 }}>
                            <Typography.Text style={{ color: "#8c8c8c", letterSpacing: 1.4, textTransform: "uppercase", fontSize: 12 }}>
                                Create account
                            </Typography.Text>
                            <Title level={3} style={{ color: "white", margin: 0 }}>
                                Register
                            </Title>
                            <Typography.Text style={{ color: "#9aa4b2" }}>
                                Set up your account in a minute.
                            </Typography.Text>
                        </Space>

                        <Divider style={{ borderColor: "rgba(255,255,255,0.08)", margin: "12px 0 20px" }} />

                        <Form form={registerForm} layout="vertical" style={{ flex: 1, display: "flex", flexDirection: "column" }} onFinish={handleRegister}>
                            <Form.Item
                                name="username"
                                label={<span style={{ color: "#ccc" }}>Username</span>}
                                rules={[{ required: true, message: "Enter a username" }]}
                                style={{ marginBottom: 16 }}
                            >
                                <Input autoComplete="username" />
                            </Form.Item>

                            <Form.Item
                                name="password"
                                label={<span style={{ color: "#ccc" }}>Password</span>}
                                rules={[{ required: true, message: "Enter a password" }]}
                                style={{ marginBottom: 12 }}
                            >
                                <Input.Password autoComplete="new-password" iconRender={(visible) =>
                                    visible ? (
                                        <EyeTwoTone twoToneColor="#fff" />
                                    ) : (
                                        <EyeInvisibleOutlined style={{ color: "#fff" }} />
                                    )
                                } />
                            </Form.Item>

                            <div style={{ marginBottom: 20 }}>
                                <PasswordStrength
                                    value={strengthValue}
                                    {...strengthChecks}
                                />
                            </div>

                            <Form.Item
                                name="confirmPassword"
                                label={<span style={{ color: "#ccc" }}>Confirm Password</span>}
                                dependencies={["password"]}
                                rules={[
                                    { required: true, message: "Confirm your password" },
                                    ({ getFieldValue }) => ({
                                        validator(_, value) {
                                            if (!value || getFieldValue("password") === value) {
                                                return Promise.resolve();
                                            }

                                            return Promise.reject(new Error("Passwords do not match"));
                                        },
                                    }),
                                ]}
                                style={{ marginBottom: 20 }}
                            >
                                <Input.Password autoComplete="new-password" iconRender={(visible) =>
                                    visible ? (
                                        <EyeTwoTone twoToneColor="#fff" />
                                    ) : (
                                        <EyeInvisibleOutlined style={{ color: "#fff" }} />
                                    )
                                } />
                            </Form.Item>

                            <Button type="primary" block htmlType="submit" style={{ marginBottom: 12 }}>
                                Create account
                            </Button>
                            {registerError && (
                                <div
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 10,
                                        background: "#2e1e1e",
                                        border: "1px solid #c4453f",
                                        borderRadius: 6,
                                        padding: "10px 12px",
                                        color: "#f87171",
                                        fontSize: 13,
                                        marginBottom: 60,
                                    }}
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <circle cx="12" cy="12" r="10" />
                                        <path d="M15 9l-6 6M9 9l6 6" />
                                    </svg>
                                    <span>{registerError}</span>
                                </div>
                            )}
                        </Form>

                        <div style={{ position: "absolute", bottom: 18, left: 0, right: 0, textAlign: "center" }}>
                            <Text style={{ color: "#8c8c8c" }}>
                                Already have an account?
                            </Text>{" "}
                            <Button
                                type="link"
                                onClick={() => {
                                    setMode("login");
                                    navigate("/login");
                                }}
                                style={{ marginLeft: 8 }}
                            >
                                Login
                            </Button>
                        </div>
                    </Card>
                </div>
            </div>
        </div>
    );
}