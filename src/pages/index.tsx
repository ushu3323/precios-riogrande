import { Add } from "@mui/icons-material";
import {
  Box,
  Button,
  CircularProgress,
  Fab,
  Grid,
  TextField,
  Typography,
} from "@mui/material";
import { type GetServerSideProps } from "next";
import { useState } from "react";
import { NextLinkComposed } from "../components/NextLinkComposed";
import PostCard from "../components/PostCard";
import { LayoutProps } from "../components/layout/Layout";
import { getServerAuthSession } from "../server/auth";
import { api } from "../utils/api";

export default function HomePage() {
  const [searchValue, setSearchValue] = useState<string>("");
  const dailyQuery = api.post.getDailyBestOffers.useQuery();

  const DailyPostsGrid = () => {
    if (!dailyQuery.data?.length) {
      return (
        <Box
          minHeight={200}
          mx="auto"
          display="flex"
          flexDirection="column"
          alignItems="center"
          justifyContent="center"
        >
          {dailyQuery.isLoading ? (
            <CircularProgress />
          ) : (
            <>
              <Typography textAlign="center" variant="subtitle1">
                No hay ofertas el dia de hoy...
              </Typography>
              <Typography variant="subtitle2" color="InactiveCaptionText">
                Se el primero en publicar!
              </Typography>
            </>
          )}
        </Box>
      );
    }
    return (
      <Grid container columns={2} spacing={2} px={1}>
        {dailyQuery.data.map((post) => (
          <Grid key={post.id} item xs={1}>
            <PostCard
              post={{
                ...post,
                price: post.price.toNumber(),
              }}
            />
          </Grid>
        ))}
      </Grid>
    );
  };

  return (
    <main>
      <Box p={2}>
        <Box mb={7}>
          <TextField
            id="search"
            label="¿Que estas buscando?"
            className="mb-5"
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            fullWidth
          />
          <Button
            variant="contained"
            disabled={searchValue.length === 0}
            fullWidth
          >
            Buscar
          </Button>
        </Box>
        <Typography component="h2" variant="h5" fontWeight={700} gutterBottom>
          Mejores ofertas de hoy
        </Typography>
      </Box>
      <DailyPostsGrid />
    </main>
  );
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const session = await getServerAuthSession(ctx);
  if (session) {
    return {
      props: {
        session,
      },
    };
  }

  return {
    redirect: {
      destination: "/auth/login",
      permanent: false,
    },
  };
};

HomePage.layoutProps = {
  containerProps: { sx: { p: 0 } },
  fab: () => (
    <Fab
      color="secondary"
      variant="extended"
      sx={{ position: "fixed", bottom: 28, right: 15 }}
      component={NextLinkComposed}
      to={{
        pathname: "/posts/new",
      }}
      prefetch
    >
      <Add sx={{ mr: 1 }} />
      <span>Publicar</span>
    </Fab>
  ),
} satisfies LayoutProps;
